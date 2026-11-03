import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { UNSORTED } from "../data/tree";
import Dialog from "../dialogs/Dialog";
import AddSourceDialog from "./AddSourceDialog";
import SubjectsDialog from "./SubjectsDialog";
import SubjectBox from "./SubjectBox";
import SourceCard from "./SourceCard";
import SourceRow from "./SourceRow";
import FindSourcesPanel from "./FindSourcesPanel";
import { sourceGroups } from "./groups";
import { sortSources, SORT_OPTIONS } from "./sorting";
import useSourceDrop from "./useSourceDrop";
import "./sources.css";
import "./boxes.css";

export const TYPE_NAMES = { link: "Link", file: "File", text: "Text" };
export const titleOf = (source) => source.title || "Untitled source";
export const ago = (time) => time ? formatDistanceToNow(new Date(time), { addSuffix: true }) : "Unknown date";

// Both routes share actions and intake. Subject routes have independent tabs;
// Unsorted stays on the overview so its rows can be dragged straight to a box.
export default function SourcesView({ subjectId = null }) {
  const { state, actions } = useStudy();
  const { open, toast, sourcesLayout, setSourcesLayout } = useShell();
  const subject = subjectId ? state.nodes[subjectId] : null;
  const groupId = subject?.type === "subject" ? subjectId : UNSORTED;
  const name = subject?.name || "Unsorted";
  const style = ["rich", "simple", "preview"].includes(sourcesLayout?.style) ? sourcesLayout.style : "rich";
  const sort = sourcesLayout?.sorts?.[groupId] || "newest";
  const [adding, setAdding] = useState(null);
  const [picking, setPicking] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { dropProps, dragProps, overId, dragging } = useSourceDrop(subjectId);
  const groups = useMemo(() => sourceGroups(state, (a, b) => (b.createdAt || 0) - (a.createdAt || 0)).filter((g) => g.id !== UNSORTED), [state]);
  const sources = sortSources(state.sources.filter((s) => subject ? s.subjects?.includes(subjectId) : !s.subjects?.length), sort);
  const allUsed = sources.length > 0 && sources.every((s) => s.use);
  const otherSubjects = (deleting?.subjects || []).filter((id) => id !== groupId).map((id) => state.nodes[id]?.name).filter(Boolean);
  const menuItems = (source) => [
    { label: "Open", onSelect: () => open({ view: "source", id: source.id }) },
    { label: "Subjects…", onSelect: () => setPicking(source.id) },
    ...(subject ? [{ label: `Remove from ${name}`, onSelect: () => { actions.removeSourceFromSubject(source.id, subjectId); toast?.(`Removed from ${name}`); } }] : []),
    { label: "Delete", danger: true, onSelect: () => setDeleting(source) },
  ];
  return <div className="st-src" data-box-style={style} {...dropProps()}>
    <div className="st-src-boxes-scroll"><div className="st-src-boxes-content">
      <FindSourcesPanel subjectName={subject?.name} />
      {subject ? <button className="st-ghost-button st-src-box-back" onClick={() => open({ view: "sources" })}><ArrowLeft size={16} /> All subjects</button> : <>
        <div className="st-src-box-heading"><h2>Subjects</h2><p>Open a subject to see and add its sources</p></div>
        <div className="st-src-box-grid" aria-label="Source subjects">
          {groups.map((group) => <SubjectBox key={group.id} group={group} style={style}
            onOpen={() => open({ view: "subject-sources", id: group.id })} dropProps={dropProps(group.id)} over={overId === group.id} />)}
        </div>
        {!groups.length && <p className="st-src-box-meta">Create a subject in the sidebar to organise your sources.</p>}
      </>}
      <section aria-label={`${name} sources`} className="st-src-collection">
        <div className="st-src-box-heading">
          <h2>{subject && <span className="st-src-box-dot" style={{ background: subject.color }} />} {name} <span className="st-src-box-meta">{sources.length} {sources.length === 1 ? "source" : "sources"}</span></h2>
          <div className="st-src-tools">
            <button className="st-src-outline" onClick={() => setAdding("link")}>Add link</button>
            <button className="st-src-outline" onClick={() => setAdding("file")}>Upload files</button>
            <button className="st-src-outline" onClick={() => setAdding("text")}>Paste text</button>
            <label className="st-src-style">Sort <select aria-label={`Sort ${name} sources`} value={sort}
              onChange={(e) => setSourcesLayout?.({ sorts: { ...sourcesLayout?.sorts, [groupId]: e.target.value } })}>
              {SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select></label>
          </div>
        </div>
        {sources.length > 0 && <label className="st-src-use-all"><input type="checkbox" className="st-src-check" checked={allUsed}
          onChange={() => actions.setSourcesUse(sources.map((s) => s.id), !allUsed)} /> Use all in {name}</label>}
        {dragging && subject && <div className="st-src-drop-subjects" aria-label="Move source to subject">
          <span>Drop to move. Hold Ctrl or Alt to keep it in both subjects.</span>
          {[...groups, { id: UNSORTED, name: "Unsorted" }].filter((g) => g.id !== groupId).map((g) => <div key={g.id} className="st-src-drop-subject" data-over={overId === g.id || undefined} {...dropProps(g.id)}>{g.name}</div>)}
        </div>}
        {subject ? <div className="st-src-box-grid">
          {sources.map((source) => <SourceCard key={source.id} source={source} style={style}
            onOpen={() => open({ view: "source", id: source.id })} menuItems={menuItems(source)} dragProps={dragProps(source, groupId)} />)}
        </div> : sources.length > 0 && <div className="st-src-list-scroll"><table className="st-src-table">
          <thead><tr><th>Use</th><th>Type</th><th>Source</th><th className="st-src-hide-sm">Added</th><th className="st-src-hide-sm">Updated</th><th>Actions</th></tr></thead>
          <tbody>{sources.map((source) => <SourceRow key={source.id} source={source} groupId={groupId}
            onOpen={() => open({ view: "source", id: source.id })} onDelete={setDeleting} menuItems={menuItems(source)} dragProps={dragProps(source, groupId)} />)}</tbody>
        </table></div>}
        {!sources.length && <div className="st-src-box-empty">{subject ? "No sources yet. Drop files, folders or links here, or use the buttons above." : "Everything is in a subject"}</div>}
      </section>
    </div></div>
    {overId === groupId && <div className="st-src-drop-overlay">Drop to add to {name}</div>}
    {adding && <AddSourceDialog subjectId={subjectId} initialType={adding} onDone={() => setAdding(null)} />}
    {picking && state.sources.some((s) => s.id === picking) && <SubjectsDialog sourceId={picking} onDone={() => setPicking(null)} />}
    {deleting && <Dialog title="Delete source" onCancel={() => setDeleting(null)}>
      <p className="st-dialog-text">Are you sure you want to delete "{titleOf(deleting)}"?{otherSubjects.length > 0 && ` It is also in ${otherSubjects.join(", ")}.`}</p>
      <div className="st-src-dialog-actions"><button className="st-ghost-button" onClick={() => setDeleting(null)}>Cancel</button>
        <button className="st-danger-button" onClick={() => { actions.deleteSource(deleting.id); setDeleting(null); }}>Delete</button></div>
    </Dialog>}
  </div>;
}
