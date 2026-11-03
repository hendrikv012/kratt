import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowDown, ArrowUp, Plus } from "lucide-react";
import { UNSORTED } from "../data/tree";
import { useStudy } from "../data/StudyProvider";
import { ago, titleOf } from "./SourcesView";
import { sourceKind, typeSummary } from "./boxSummary";
import SourceCard from "./SourceCard";
import FindSourcesPanel from "./FindSourcesPanel";

function SubjectBox({ group, style, onOpen, dropProps, over }) {
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

export default function SourcesBoxes({ groups, style, groupId, onGroup, onAdd, onOpen, menuItems, dragProps, dropProps, dragging, overId, sort, onSort }) {
  const { actions } = useStudy();
  // Keep Unsorted available as a destination, including when it is empty.
  const destinations = groups.some((g) => g.id === UNSORTED) ? groups : [...groups, { id: UNSORTED, name: "Unsorted", sources: [] }];
  const active = destinations.find((g) => g.id === groupId);
  const heading = useRef(null);
  const previous = useRef(groupId);
  useEffect(() => {
    if (previous.current !== groupId) heading.current?.focus();
    previous.current = groupId;
  }, [groupId]);
  const allUsed = active?.sources.length > 0 && active.sources.every((s) => s.use);
  const Direction = sort.order === "asc" ? ArrowUp : ArrowDown;

  return (
    <div className="st-src-boxes-scroll">
      <div className="st-src-boxes-content" data-subject={active ? "true" : undefined}>
      {!active && <FindSourcesPanel />}
      {active && <button className="st-ghost-button st-src-box-back" onClick={() => onGroup(null)}><ArrowLeft size={16} /> All subjects</button>}
      <div className="st-src-box-heading">
        <h2 tabIndex={-1} ref={heading}>{active?.name || "Subjects"}</h2>
        <p>{active ? `${active.sources.length} ${active.sources.length === 1 ? "source" : "sources"}` : "Open a subject to see and add its sources"}</p>
      </div>
      {active ? <>
        <div className="st-src-box-toolbar">
          <label><input type="checkbox" className="st-src-check" checked={allUsed} disabled={!active.sources.length}
            onChange={() => actions.setSourcesUse(active.sources.map((s) => s.id), !allUsed)} /> Use all in {active.name}</label>
          <div className="st-src-tools">
            <button className="st-src-outline" onClick={onAdd}><Plus size={15} aria-hidden="true" /> New source</button>
            <label className="st-src-style">Sort by <select value={sort.by} onChange={(e) => onSort({ ...sort, by: e.target.value })}>
              <option value="updated">Updated</option><option value="created">Created</option><option value="title">Title</option><option value="type">Type</option>
            </select></label>
            <button className="st-icon-button" aria-label={sort.order === "asc" ? "Sort descending" : "Sort ascending"}
              onClick={() => onSort({ ...sort, order: sort.order === "asc" ? "desc" : "asc" })}><Direction size={16} /></button>
          </div>
        </div>
        {dragging && <div className="st-src-drop-subjects" aria-label="Move source to subject">
          <span>Drop on a subject to move. Hold Ctrl or Alt to keep it in both.</span>
          {destinations.map((group) => <div key={group.id} className="st-src-drop-subject" data-over={overId === group.id || undefined} {...dropProps(group)}>{group.name}</div>)}
        </div>}
        <section aria-label={`${active.name} sources`} className="st-src-box-grid" data-over={overId === active.id || undefined} {...dropProps(active)}>
          {active.sources.map((source) => <SourceCard key={source.id} source={source} style={style} onOpen={() => onOpen(source)}
            menuItems={menuItems(source, active)} dragProps={dragProps(source, active.id)} />)}
        </section>
        {!active.sources.length && <div className="st-src-box-empty"><h3>No sources yet</h3><p>Add a link, file or pasted text to {active.name}.</p>
          <button className="st-src-outline" onClick={onAdd}><Plus size={16} /> New source</button></div>}
      </> : <div className="st-src-box-grid" aria-label="Source subjects">
        {destinations.map((group) => <SubjectBox key={group.id} group={group} style={style} onOpen={() => onGroup(group.id)} dropProps={dropProps(group)} over={overId === group.id} />)}
      </div>}
      </div>
    </div>
  );
}
