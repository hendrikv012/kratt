// Turns a drop or paste (DataTransfer / clipboardData) into files and links,
// and filters out what the list already holds. Pure: no React, no network.

export const MAX_FILE_BYTES = 50 * 1000 ** 3;

const JUNK = /^(thumbs\.db|desktop\.ini)$/i;
const isHidden = (name) => name.startsWith(".") || JUNK.test(name);

export const isUrl = (line) => {
  try {
    const url = new URL(line);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const readBatch = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
const getFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

async function walk(entry, prefix, out) {
  if (isHidden(entry.name)) {
    out.skipped.push({ name: entry.name, reason: "hidden" });
    return;
  }
  const relPath = prefix + entry.name;
  if (entry.isDirectory) {
    try {
      const reader = entry.createReader();
      for (;;) {
        const children = await readBatch(reader);
        if (!children.length) break;
        for (const child of children) await walk(child, relPath + "/", out);
      }
    } catch {
      out.skipped.push({ name: entry.fullPath ?? entry.name, reason: "unreadable" });
    }
    return;
  }
  let file;
  try {
    file = await getFile(entry);
  } catch {
    out.skipped.push({ name: entry.fullPath ?? entry.name, reason: "unreadable" });
    return;
  }
  if (file.size > MAX_FILE_BYTES) out.skipped.push({ name: entry.name, reason: "too large" });
  else out.files.push({ file, relPath });
}

function linksFrom(transfer) {
  const uris = (transfer.getData?.("text/uri-list") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (uris.length) return uris.filter(isUrl);
  return (transfer.getData?.("text/plain") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(isUrl);
}

const addPlain = (file, out) => {
  if (isHidden(file.name)) out.skipped.push({ name: file.name, reason: "hidden" });
  else if (file.size > MAX_FILE_BYTES) out.skipped.push({ name: file.name, reason: "too large" });
  else if ((file.webkitRelativePath || file.name).split("/").some(isHidden)) out.skipped.push({ name: file.name, reason: "hidden" });
  else out.files.push({ file, relPath: file.webkitRelativePath || file.name });
};

export async function intakeFrom(transfer) {
  const out = { files: [], links: [], skipped: [] };
  // DataTransfer contents are only readable during the event: take entries,
  // files and link text synchronously, before the first await.
  const fileItems = Array.from(transfer.items ?? []).filter((it) => it.kind === "file");
  const plain = Array.from(transfer.files ?? []);
  const items = fileItems.map((item, index) => ({
    entry: item.webkitGetAsEntry?.(), file: item.getAsFile?.() ?? plain[index],
  }));
  out.links = [...new Set(linksFrom(transfer))];
  // FileList and file-kind items have the same order. Pair by index: browsers
  // need not return the same File wrapper, and a directory can share a file's name.
  for (const { entry, file } of items) {
    if (entry) await walk(entry, "", out);
    else if (file) addPlain(file, out);
  }
  for (const file of plain.slice(items.length)) addPlain(file, out);
  return out;
}

// Same URL, or same file name + size, is already a source.
export function dedupe(state, { files, links }) {
  const existing = new Set();
  const seenFiles = new Set();
  const newFiles = files.filter(({ file }) => {
    const key = JSON.stringify([file.name, file.size]);
    const hit = state.sources.find((s) => s.fileName === file.name && s.fileSize === file.size);
    if (hit) existing.add(hit.id);
    if (hit || seenFiles.has(key)) return false;
    seenFiles.add(key);
    return true;
  });
  const newLinks = [...new Set(links)].filter((url) => {
    const hit = state.sources.find((s) => s.url === url);
    if (hit) existing.add(hit.id);
    return !hit;
  });
  return { files: newFiles, links: newLinks, existing: [...existing] };
}
