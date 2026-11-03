import { UNSORTED } from "../data/tree";
import { ago, titleOf } from "./SourcesView";
import { sourceKind, typeSummary } from "./boxSummary";

export default function SubjectBox({ group, style, onOpen, dropProps, over }) {
  const count = group.sources.length;
  const latest = group.sources.reduce((time, source) => Math.max(time, source.createdAt || 0), 0);
  return (
    <button className="st-src-box st-src-subject-box" onClick={onOpen} aria-label={`Open ${group.name}, ${count} ${count === 1 ? "source" : "sources"}`}
      data-over={over || undefined} {...dropProps}>
      <span className="st-src-box-title"><span className="st-src-box-dot" style={{ background: group.color || "var(--st-text-faint)" }} />
        <span>{group.name}</span>{style !== "rich" && <span className="st-src-box-count-small">{count}</span>}
      </span>
      {style === "rich" && <>
        <span className="st-src-box-count"><strong>{count}</strong> {count === 1 ? "source" : "sources"}</span>
        <span className="st-src-box-meta st-src-box-summary">{typeSummary(group.sources) || "No sources yet"}
          <span>{group.id === UNSORTED ? "Not in any subject yet" : latest ? `Last added ${ago(latest)}` : "Open to add your first source"}</span>
        </span>
      </>}
      {style === "preview" && <span className="st-src-box-preview">
        {count === 0 && <span className="st-src-box-meta">No sources yet. Open to add one.</span>}
        {group.sources.slice(0, 3).map((source) => <span className="st-src-box-preview-row" key={source.id}>
          <span>{sourceKind(source)}</span><span>{titleOf(source)}</span>
        </span>)}
        {count > 3 && <span className="st-src-box-more">+ {count - 3} more</span>}
      </span>}
    </button>
  );
}
