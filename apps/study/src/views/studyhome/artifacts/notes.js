import { ChatError, byteLength, cutToBytes } from "../chats/chatService";
import { pagesInside } from "../data/tree";
import { pageMarkdown } from "../data/vaultState";

// The smallest part Kratt is asked to fill; below this the headers alone would crowd out the notes.
export const MIN_ROOM = 512;
const TITLE_BYTES = 200;

// The whole of each selected note: a page, every page in a subject or folder, or a source. Nothing is cut.
export function gatherFull(state, ids) {
  const notes = [];
  const seen = new Set();
  const add = (id, title, markdown) => {
    if (seen.has(id)) return;
    seen.add(id);
    notes.push({ id, title, markdown });
  };
  const addPage = (id) => {
    const node = state.nodes[id];
    if (node?.type === "page") add(id, node.name, pageMarkdown(node));
  };
  for (const id of ids) {
    const node = state.nodes[id];
    if (node?.type === "page") addPage(id);
    else if (node && (node.type === "subject" || node.type === "folder")) pagesInside(state, id).forEach(addPage);
    else {
      const source = state.sources?.find((s) => s.id === id);
      if (source) add(source.id, source.title, source.content);
    }
  }
  return notes;
}

const header = (title, k, n) => {
  const shown = cutToBytes(title, TITLE_BYTES);
  return n > 1 ? `## [[${shown}]] (part ${k} of ${n})\n` : `## [[${shown}]]\n`;
};
const written = (title, k, n, markdown) => `${header(title, k, n)}${markdown}\n`;

// Where to cut the start of `rest` so the piece is at most `limit` bytes: before a heading, else
// after a blank line, else after a line break, else at the byte limit.
// How many characters of `text` fit in `limit` bytes, never splitting a character. Always at least
// one character, so a cut moves forward even when `limit` is tiny.
function fitChars(text, limit) {
  let size = 0;
  let at = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (at > 0 && size + width > limit) break;
    size += width;
    at += ch.length;
  }
  return at;
}

function cutPoint(rest, limit) {
  const fit = fitChars(rest, limit);
  if (fit === rest.length) return rest.length;
  const head = rest.slice(0, fit);
  const heading = head.lastIndexOf("\n#");
  if (heading > 0) return heading + 1;
  const blank = head.lastIndexOf("\n\n");
  if (blank >= 0 && blank + 2 > 0) return blank + 2;
  const line = head.lastIndexOf("\n");
  if (line >= 0) return line + 1;
  return fit;
}

// Every note in order, packed into parts of at most `room` bytes. A note too big for an empty part is
// cut into consecutive slices, so joining a note's pieces gives it back exactly.
export function splitIntoParts(notes, room) {
  if (!(room >= MIN_ROOM)) {
    throw new ChatError("too-long", "There isn't enough room in Chat memory to send notes. Pick a longer Chat memory in Settings > AI.");
  }
  const worst = byteLength(`## [[${"t".repeat(TITLE_BYTES)}]] (part ${Number.MAX_SAFE_INTEGER} of ${Number.MAX_SAFE_INTEGER})\n`) + 1;
  const limit = room - worst;
  const parts = [];
  let current = null;
  let used = 0;
  const place = (piece) => {
    const text = written(piece.title, piece.k, piece.n, piece.markdown);
    const size = byteLength(text);
    if (!current || used + size > room) {
      current = { text: "", pieces: [] };
      parts.push(current);
      used = 0;
    }
    current.text += text;
    current.pieces.push(piece);
    used += size;
  };
  for (const note of notes) {
    const { id: noteId, title, markdown } = note;
    if (byteLength(written(title, 1, 1, markdown)) <= room) {
      place({ noteId, title, k: 1, n: 1, markdown });
      continue;
    }
    const slices = [];
    let rest = markdown;
    while (rest.length) {
      const at = cutPoint(rest, limit);
      slices.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    slices.forEach((slice, i) => place({ noteId, title, k: i + 1, n: slices.length, markdown: slice }));
  }
  return parts;
}
