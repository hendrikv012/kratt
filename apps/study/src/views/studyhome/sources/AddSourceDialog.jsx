import { useState } from "react";
import { FileText, Link as LinkIcon, File as FileIcon } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import Dialog from "../dialogs/Dialog";
import { isUrl } from "./intake";
import { intakeFrom } from "./intake";
import { useUploads } from "./UploadsProvider";

// "Add source", like Open Notebook's (components/sources/steps/
// SourceTypeStep.tsx): pick Add URL, Upload file or Enter text, fill it in.
// Open Notebook's later steps (notebooks, AI processing) don't exist here.
// Links and files go through ingest (no duplicates; originals kept in
// Sources/files/); everything added joins `subjectId` when one is given.

const TYPES = [
  { value: "link", label: "Add URL", icon: LinkIcon, description: "Import an article or webpage from a URL." },
  { value: "file", label: "Upload file", icon: FileIcon, description: "Upload a PDF, audio, video, or document file." },
  { value: "text", label: "Enter text", icon: FileText, description: "Paste or type content directly." },
];

const titleFromText = (text) => text.trim().split("\n")[0].slice(0, 80);

export default function AddSourceDialog({ onDone, subjectId = null, initialType = "link" }) {
  const { actions, client } = useStudy();
  const uploads = useUploads();
  const [uploadError, setUploadError] = useState(null);
  const [type, setType] = useState(initialType);
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
    try {
      if (type === "text") {
        await client.folder();
        actions.addSources([{ type: "text", title: title.trim() || titleFromText(text), content: text, subjects: subjectId ? [subjectId] : [] }]);
        onDone();
      } else {
        const intake = type === "link" ? { files: [], links: [...new Set(lines)], skipped: [] } : await intakeFrom({ files });
        await uploads.add(intake, subjectId, { onAccepted: onDone });
      }
    } catch (error) {
      setUploadError(error.message);
    } finally { setBusy(false); }

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
          <small>PDFs and text files (TXT, MD, CSV, HTML) keep their text. Every file type is kept in your Study folder, up to 50 GB per file.</small>
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
        <button className="st-button" onClick={add} disabled={!ready || busy}>{busy ? "Adding…" : "Add source"}</button>
      </div>
    </Dialog>
  );
}
