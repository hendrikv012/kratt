// Adds dropped, pasted or picked files and links as sources, then keeps each
// file's original in Sources/files/ of the Study folder. No React.
//
// plan() adds every new source at once (files marked `upload: uploading`), so
// they show straight away; run() then saves the originals one at a time and
// clears the mark, or sets `upload: not-saved` when one couldn't be kept.
// Nothing here ever creates a subject.

import { pdfText } from "./readPdf";
import { dedupe } from "./intake";
import { newId } from "../data/operations";
import { sanitizeName } from "../data/vaultState";

// More new sources than this in one go asks first.
export const CONFIRM_OVER = 50;

// Files whose text the app can keep (plain text, and PDFs through PDF.js);
// anything else, or anything bigger, keeps only its original.
const PDF_FILE = /\.pdf$/i;
const TEXT_FILE = /\.(txt|md|markdown|csv|json|html?|xml|tex|ya?ml|rtf)$/i;
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;

const ORIGINALS = "Sources/files";

export const titleFromUrl = (line) => {
  const url = new URL(line);
  return (url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "")).slice(0, 120);
};

export const titleFromFile = (name) => name.replace(/\.[^.]+$/, "");

// Where a file's original goes: its folders kept, each part a safe name.
export const originalPath = (relPath) => `${ORIGINALS}/${relPath.split("/").map(sanitizeName).join("/")}`;

const isPdf = (file) => file.type === "application/pdf" || PDF_FILE.test(file.name);
const isText = (file) => (file.type ?? "").startsWith("text/") || TEXT_FILE.test(file.name);

const readText = (file) =>
  typeof file.text === "function"
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });

// The text fields a file adds to its source (none for files the app can't read).
export async function readFile(file, readPdf = pdfText) {
  if (isPdf(file)) {
    if (file.size > MAX_PDF_BYTES) return {};
    try {
      const pdf = await readPdf(file);
      return { content: pdf.text, pageCount: pdf.pageCount, readPages: pdf.readPages, truncated: pdf.truncated, noText: !pdf.text };
    } catch {
      return { readFailed: true }; // damaged or locked PDF: keep its name
    }
  }
  if (isText(file) && file.size <= MAX_TEXT_BYTES) {
    try {
      return { content: await readText(file) };
    } catch {
      return {}; // unreadable: keep its name, as for other files
    }
  }
  return {};
}

const isAbort = (error) => error?.name === "AbortError";

export function createIngest({ client, actions, getState, readPdf = pdfText }) {
  // intake: { files: [{ file, relPath }], links: [url], skipped: [{ name, reason }] }.
  // `confirm(count)` is asked when more than CONFIRM_OVER would be added; a no
  // changes nothing and returns `cancelled: true`.
  function plan(intake, subjectId, { confirm } = {}) {
    const fresh = dedupe(getState(), { files: intake.files ?? [], links: intake.links ?? [] });
    // Hidden files are skipped silently; too large or unreadable ones are reported.
    const skipped = (intake.skipped ?? []).filter((s) => s.reason !== "hidden").length;
    const count = fresh.files.length + fresh.links.length;
    if (confirm && count > CONFIRM_OVER && !confirm(count)) {
      return { sources: [], uploads: [], existing: [], count, skipped, cancelled: true };
    }

    // Already there: the source joins the subject instead of a copy being added.
    if (subjectId) for (const id of fresh.existing) actions.addSourceToSubject(id, subjectId);

    const subjects = subjectId ? [subjectId] : [];
    const links = fresh.links.map((url) => ({ id: newId(), type: "link", url, title: titleFromUrl(url), subjects }));
    const uploads = fresh.files.map(({ file, relPath }) => ({ id: newId(), file, path: originalPath(relPath) }));
    const files = uploads.map(({ id, file }) => ({
      id,
      type: "file",
      title: titleFromFile(file.name),
      fileName: file.name,
      fileSize: file.size,
      upload: "uploading",
      subjects,
    }));
    const sources = [...links, ...files];
    if (sources.length) actions.addSources(sources);
    return { sources, uploads, existing: fresh.existing, count, skipped };
  }

  // Saves the planned originals one at a time. A file that fails (refused by
  // the upload check, a failed upload, the service gone) is marked not saved
  // and the next one goes on; after Cancel the unstarted sources are removed.
  // Resolves, never rejects: { added, existing, notSaved, skipped, messages: [{ name, message }] }.
  async function run(planned, { onProgress, signal } = {}) {
    const { uploads } = planned;
    const total = uploads.length;
    const totalBytes = uploads.reduce((sum, u) => sum + u.file.size, 0);
    const messages = [];
    let doneBytes = 0;
    let notSaved = 0;
    let cancelled = 0;
    const present = (id) => getState().sources.some((s) => s.id === id);

    for (const [i, { id, file, path }] of uploads.entries()) {
      if (signal?.aborted) {
        if (present(id)) actions.deleteSource(id);
        cancelled += 1;
        continue;
      }
      if (!present(id)) continue;
      const size = file.size;
      const progress = (loaded) =>
        onProgress?.({ index: i + 1, total, name: file.name, loaded, size, doneBytes: doneBytes + loaded, totalBytes });
      progress(0);
      let read = {};
      try {
        if (signal?.aborted) throw Object.assign(new Error("Upload cancelled"), { name: "AbortError" });
        await client.uploadCheck(path, size);
        read = await readFile(file, readPdf);
        if (signal?.aborted) throw Object.assign(new Error("Upload cancelled"), { name: "AbortError" });
        // `total` can be 0 when the browser can't tell the length; the file's size is known.
        const answer = await client.upload(path, file, { signal, onProgress: (loaded) => progress(Math.min(loaded, size)) });
        if (present(id)) actions.updateSource(id, { ...read, file: answer.path, upload: undefined });
        else await client.trash(answer.path);
        progress(size);
      } catch (error) {
        if (present(id)) actions.updateSource(id, { ...read, upload: "not-saved" });
        notSaved += 1;
        if (!isAbort(error)) messages.push({ name: file.name, message: error?.message ?? String(error) });
      }
      doneBytes += size;
    }

    return {
      added: planned.sources.length - cancelled,
      cancelled,
      existing: planned.existing.length,
      notSaved,
      skipped: planned.skipped ?? 0,
      messages,
    };
  }

  return { plan, run };
}
