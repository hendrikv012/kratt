// A chat's turns ↔ the Markdown body of its file in Chats/.
//
//   ### You
//   Walk me through one turn of the cycle.
//
//   ### Kratt
//   One turn, from your notes: ...
//
// Files can be edited by hand, so reading never drops text: anything before the first
// "### You" or "### Kratt" becomes a turn of yours, and any other heading stays part of the
// turn above it.

const HEADING = /^###[ \t]+(you|kratt)[ \t]*$/i;
const MAX_TITLE = 48;

// Files saved on Windows end their lines in \r\n; read them as \n so headings still match.
const lf = (s) => String(s ?? "").replace(/\r\n?/g, "\n");

// Blank lines around a turn are the file's spacing, not the turn's text, so a turn is kept
// without them (and reads back the same).
export const turnText = (text) => String(text ?? "").replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");

export function parseTurns(body) {
  const turns = [];
  let who = null;
  let lines = [];
  const finish = () => {
    const text = turnText(lines.join("\n"));
    if (who || text) turns.push({ who: who ?? "you", text });
  };
  for (const line of lf(body).split("\n")) {
    const heading = HEADING.exec(line);
    if (!heading) {
      lines.push(line);
      continue;
    }
    finish();
    who = heading[1].toLowerCase() === "kratt" ? "kratt" : "you";
    lines = [];
  }
  finish();
  return turns;
}

// A line of a turn that reads exactly like a turn heading would reload as a new turn; one
// space in front keeps it the same heading to look at but not to parseTurns.
export const escapeHeadings = (text) =>
  lf(text).split("\n").map((line) => (HEADING.test(line) ? ` ${line}` : line)).join("\n");

export const formatTurns = (turns) =>
  turns.map((turn) => `### ${turn.who === "kratt" ? "Kratt" : "You"}\n${turn.text}\n`).join("\n");

// The first question, cut at a word boundary to fit 48 characters.
export function chatTitle(question) {
  const text = String(question ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "New chat";
  if (text.length <= MAX_TITLE) return text;
  const space = text.lastIndexOf(" ", MAX_TITLE);
  const cut = space > 0 ? text.slice(0, space) : text.slice(0, MAX_TITLE);
  return cut.replace(/[\s,;:.\-–—]+$/, "") || cut;
}
