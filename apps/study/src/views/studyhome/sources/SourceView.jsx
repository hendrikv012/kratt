import { useState } from "react";
import { ArrowLeft, Link as LinkIcon, Trash2 } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import Dialog from "../dialogs/Dialog";
import { ago, titleOf, TYPE_NAMES } from "./SourcesView";
import "./sources.css";

// One source, like Open Notebook's source page (components/sources/
// SourceDetailContent.tsx): its title, then Content and Details tabs.
// Open Notebook's Insights tab needs the AI, so it isn't here yet.

const sizeText = (bytes) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function SourceView({ id }) {
  const { state, actions } = useStudy();
  const { open } = useShell();
  const [tab, setTab] = useState("content");
  const [deleting, setDeleting] = useState(false);
  const source = state.sources.find((s) => s.id === id);
  if (!source) return null;

  const words = source.content ? source.content.trim().split(/\s+/).filter(Boolean).length : 0;
  const details = [
    ["Type", TYPE_NAMES[source.type]],
    ["Added", ago(source.createdAt)],
    ["Updated", ago(source.updatedAt)],
    source.url && ["Address", source.url],
    source.fileName && ["File", `${source.fileName} (${sizeText(source.fileSize)})`],
    source.pageCount && ["Pages", String(source.pageCount)],
    ["Words", String(words)],
    ["Used", source.use ? "Yes" : "No"],
  ].filter(Boolean);

  return (
    <div className="st-src st-src-detail">
      <button className="st-ghost-button st-src-back" onClick={() => open({ view: "sources" })}>
        <ArrowLeft size={15} aria-hidden="true" /> All sources
      </button>

      <header className="st-src-detail-head">
        <div>
          <span className="st-src-type">
            <span className="st-src-dot" data-type={source.type} aria-hidden="true" />
            {TYPE_NAMES[source.type]}
          </span>
          <input
            className="st-src-detail-title"
            value={source.title}
            placeholder="Untitled source"
            aria-label="Source title"
            onChange={(e) => actions.updateSource(source.id, { title: e.target.value })}
          />
        </div>
        <button className="st-icon-button st-src-delete" aria-label="Delete source" onClick={() => setDeleting(true)}>
          <Trash2 size={16} />
        </button>
      </header>

      <div className="st-src-tabs st-src-tabs-line" role="tablist" aria-label="Source">
        <button role="tab" aria-selected={tab === "content"} onClick={() => setTab("content")}>Content</button>
        <button role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>Details</button>
      </div>

      {tab === "content" ? (
        <section className="st-src-content">
          {source.url && (
            <p className="st-src-link">
              <LinkIcon size={14} aria-hidden="true" />
              <a href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a>
            </p>
          )}
          {source.truncated && (
            <p className="st-src-muted st-src-note">
              This PDF is long, so only its first {source.readPages} of {source.pageCount} pages are kept.
            </p>
          )}
          {source.content ? (
            <div className="st-src-text">{source.content}</div>
          ) : (
            <p className="st-src-muted">
              {source.type === "link"
                ? "Only the address is kept for now. Open it to read the page."
                : source.noText
                  ? "This PDF has no text to read. It may be made of scanned pages."
                  : source.readFailed
                    ? "This PDF couldn't be opened. It may be damaged or password-protected."
                    : source.type === "file"
                      ? "Only this file's name is kept for now. Its text can't be read here yet."
                      : "No content available."}
            </p>
          )}
        </section>
      ) : (
        <section className="st-src-content">
          <dl className="st-src-details">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {deleting && (
        <Dialog title="Delete source" onCancel={() => setDeleting(false)}>
          <p className="st-dialog-text">Are you sure you want to delete "{titleOf(source)}"?</p>
          <div className="st-src-dialog-actions">
            <button className="st-ghost-button" onClick={() => setDeleting(false)}>Cancel</button>
            <button
              className="st-danger-button"
              onClick={() => {
                actions.deleteSource(source.id);
                open({ view: "sources" });
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
