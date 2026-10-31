import { useState } from "react";
import { FileText, Link as LinkIcon, File as FileIcon } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import Dialog from "../dialogs/Dialog";
import { pdfText } from "./readPdf";
import { sanitizeName } from "../data/vaultState";

// "Add source", like Open Notebook's (components/sources/steps/
// SourceTypeStep.tsx): pick Add URL, Upload file or Enter text, fill it in.
// Open Notebook's later steps (notebooks, AI processing) don't exist here.

const TYPES = [
  { value: "link", label: "Add URL", icon: LinkIcon, description: "Import an article or webpage from a URL." },
  { value: "file", label: "Upload file", icon: FileIcon, description: "Upload a PDF, audio, video, or document file." },
  { value: "text", label: "Enter text", icon: FileText, description: "Paste or type content directly." },
];

// Files whose text the app can keep (plain text, and PDFs through PDF.js);
// anything else keeps its name and size.
const PDF_FILE = /\.pdf$/i;
const TEXT_FILE = /\.(txt|md|markdown|csv|json|html?|xml|tex|ya?ml|rtf)$/i;
const MAX_TEXT_BYTES = 1024 * 1024;

const isUrl = (line) => {
  try {
    const url = new URL(line);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const titleFromUrl = (line) => {
  const url = new URL(line);
  return (url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "")).slice(0, 120);
};

const titleFromText = (text) => text.trim().split("\n")[0].slice(0, 80);

const readText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

async function readFile(file) {
  const base = { type: "file", title: file.name.replace(/\.[^.]+$/, ""), fileName: file.name, fileSize: file.size };
  if (file.type === "application/pdf" || PDF_FILE.test(file.name)) {
    try {
      const pdf = await pdfText(file);
      return { ...base, content: pdf.text, pageCount: pdf.pageCount, readPages: pdf.readPages, truncated: pdf.truncated, noText: !pdf.text };
    } catch {
      return { ...base, readFailed: true }; // damaged or locked PDF: keep its name
    }
  }
  if ((file.type.startsWith("text/") || TEXT_FILE.test(file.name)) && file.size <= MAX_TEXT_BYTES) {
    try {
      return { ...base, content: await readText(file) };
    } catch {
      return base; // unreadable: keep its name, as for other files
    }
  }
  return base;
}

export default function AddSourceDialog({ onDone }) {
  const { actions, client } = useStudy();
  const [uploadError, setUploadError] = useState(null);
  const [type, setType] = useState("link");
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const lines = urls.split("\n").map((l) => l.trim()).filter(Boolean);
  const badLines = lines.map((l, i) => ({ line: i + 1, url: l })).filter(({ url }) => !isUrl(url));
  const ready = type === "link" ? lines.length > 0 && badLines.length === 0 : type === "file" ? files.length > 0 : text.trim().length > 0;

  const add = async () => {
    if (!ready || busy) return;
    setBusy(true);
    let items;
    if (type === "link") items = lines.map((url) => ({ type: "link", url, title: titleFromUrl(url) }));
    else if (type === "file") items = await Promise.all(files.map(readFile));
    else items = [{ type: "text", title: title.trim() || titleFromText(text), content: text }];
    // Uploaded files also keep their original in Sources/files/ of the Study folder.
    const failed = [];
    if (type === "file") {
      items = await Promise.all(
        items.map(async (item, index) => {
          try {
            const answer = await client.upload(`Sources/files/${sanitizeName(files[index].name)}`, files[index]);
            return { ...item, file: answer.path };
          } catch (error) {
            failed.push(`${files[index].name}: ${error.message}`);
            return item;
          }
        })
      );
    }
    actions.addSources(items);
    if (failed.length) {
      setBusy(false);
      setUploadError(`Added, but the original file couldn't be kept (${failed.join("; ")})`);
      return;
    }
    onDone();
  };

  const current = TYPES.find((t) => t.value === type);

  return (
    <Dialog title="Add source" onCancel={onDone}>
      <p className="st-dialog-text">Bring in content from a link, file, or pasted text.</p>
      <div className="st-src-tabs" role="tablist" aria-label="Source type">
        {TYPES.map(({ value, label, icon: Icon }) => (
          <button key={value} role="tab" aria-selected={type === value} onClick={() => setType(value)}>
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p className="st-src-field-hint">{current.description}</p>

      {type === "link" && (
        <label className="st-src-field">
          <span>URL(s)</span>
          <textarea
            rows={4}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={"Enter URLs, one per line\nhttps://example.com/article1\nhttps://example.com/article2"}
            autoFocus
          />
          <small>Paste multiple URLs (one per line) to add them all at once.</small>
          {badLines.length > 0 && (
            <small className="st-src-error">
              Not a web address: {badLines.map(({ line, url }) => `line ${line} (${url})`).join(", ")}. Fix or remove it to continue.
            </small>
          )}
        </label>
      )}

      {type === "file" && (
        <label className="st-src-field">
          <span>File(s)</span>
          <input type="file" multiple onChange={(e) => setFiles([...e.target.files])} />
          <small>PDFs and text files (TXT, MD, CSV, HTML) keep their text. Other files (documents, media) keep their name for now.</small>
          {files.length > 0 && <small>{files.map((f) => f.name).join(", ")}</small>}
        </label>
      )}

      {type === "text" && (
        <>
          <label className="st-src-field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give your source a descriptive title" />
            <small>If left empty, the first line becomes the title.</small>
          </label>
          <label className="st-src-field">
            <span>Text content</span>
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste or type your content here..." />
          </label>
        </>
      )}

      {uploadError && <p className="st-src-error" role="alert">{uploadError}</p>}
      <div className="st-src-dialog-actions">
        <button className="st-ghost-button" onClick={onDone}>{uploadError ? "Close" : "Cancel"}</button>
        <button className="st-button" onClick={add} disabled={!ready || busy}>{busy ? "Reading…" : "Add source"}</button>
      </div>
    </Dialog>
  );
}
