import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Plus } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import Dialog from "../dialogs/Dialog";
import AddSourceDialog from "./AddSourceDialog";
import SourceGroup, { Cols } from "./SourceGroup";
import SourceRow from "./SourceRow";
import SubjectsDialog from "./SubjectsDialog";
import { UNSORTED } from "../data/tree";
import { sourceGroups, readCollapsed, writeCollapsed, isCollapsed, dropAction, dropMessage } from "./groups";
import "./sources.css";

// The Sources tab, laid out like Open Notebook's (frontend/src/app/
// (dashboard)/sources/page.tsx): a sortable table of every source with its
// type, title, when it was added and changed, and delete. Study addition:
// a tick for which sources to use, and a group per subject (a source in two
// subjects shows in both; the rest sit under Unsorted).

export const TYPE_NAMES = { link: "Link", file: "File", text: "Text" };
export const titleOf = (source) => source.title || "Untitled source";
export const ago = (time) => formatDistanceToNow(new Date(time), { addSuffix: true });

const SORTS = {
  type: (a, b) => a.type.localeCompare(b.type),
  title: (a, b) => titleOf(a).localeCompare(titleOf(b)),
  created: (a, b) => a.createdAt - b.createdAt,
  updated: (a, b) => a.updatedAt - b.updatedAt,
};

function SortHeader({ field, label, sort, onSort }) {
  const active = sort.by === field;
  const Icon = active ? (sort.order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button className="st-src-sort" onClick={() => onSort(field)} aria-label={`Sort by ${label.toLowerCase()}`}>
      {label}
      <Icon size={12} aria-hidden="true" data-active={active || undefined} />
    </button>
  );
}

export default function SourcesView() {
  const { state, actions } = useStudy();
  const { open, toast } = useShell();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [sort, setSort] = useState({ by: "updated", order: "desc" });
  const [selectedKey, setSelectedKey] = useState(null);
  const [picking, setPicking] = useState(null);
  // The Subjects dialog counts as open only while its source still exists.
  const pickingOpen = picking !== null && state.sources.some((s) => s.id === picking);
  const [dragging, setDragging] = useState(null); // { id, from }
  const [overId, setOverId] = useState(null);
  const [collapsedMap, setCollapsedMap] = useState(readCollapsed);

  const compare = useMemo(() => {
    const by = SORTS[sort.by];
    return sort.order === "desc" ? (a, b) => by(b, a) : by;
  }, [sort]);
  const groups = useMemo(() => sourceGroups(state, compare), [state, compare]);

  // The rows on screen, in order; a collapsed group has none. Keys are per row
  // instance because one source can sit in several groups.
  const rows = useMemo(
    () =>
      groups.flatMap((g) =>
        isCollapsed(collapsedMap, g) ? [] : g.sources.map((source) => ({ key: `${g.id}:${source.id}`, source }))
      ),
    [groups, collapsedMap]
  );
  const current = rows.find((r) => r.key === selectedKey) ?? rows[0];

  const onSort = (by) => {
    setSelectedKey(null);
    setSort((s) => (s.by === by ? { by, order: s.order === "asc" ? "desc" : "asc" } : { by, order: "desc" }));
  };

  const toggle = (group) => {
    const next = { ...collapsedMap, [group.id]: !isCollapsed(collapsedMap, group) };
    setCollapsedMap(next);
    writeCollapsed(next);
  };

  const endDrag = () => {
    setDragging(null);
    setOverId(null);
  };
  // Drop target props for a group; only groups that would change something react.
  const dropProps = (group) => ({
    onDragOver: (e) => {
      if (!dragging) return;
      const action = dropAction(state, dragging.id, dragging.from, group.id, e.ctrlKey || e.altKey);
      if (action.type === "none") return;
      e.preventDefault();
      setOverId(group.id);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOverId((o) => (o === group.id ? null : o));
    },
    onDrop: (e) => {
      if (!dragging) return;
      e.preventDefault();
      const action = dropAction(state, dragging.id, dragging.from, group.id, e.ctrlKey || e.altKey);
      if (action.type === "move") actions.moveSourceToSubject(dragging.id, action.fromId, action.subjectId);
      else if (action.type === "add") actions.addSourceToSubject(dragging.id, action.subjectId);
      else if (action.type === "remove") actions.removeSourceFromSubject(dragging.id, action.subjectId);
      const message = dropMessage(action, state);
      if (message) toast(message);
      endDrag();
    },
  });
  const dragProps = (source, groupId) => ({
    draggable: true,
    onDragStart: (e) => {
      setDragging({ id: source.id, from: groupId });
      if (e.dataTransfer) {
        e.dataTransfer.setData("application/x-study-source", source.id);
        e.dataTransfer.effectAllowed = "copyMove";
      }
    },
    onDragEnd: endDrag,
  });
  const menuItems = (source, group) => [
    { label: "Open", onSelect: () => open({ view: "source", id: source.id }) },
    { label: "Subjects…", onSelect: () => setPicking(source.id) },
    ...(group.id === UNSORTED
      ? []
      : [
          {
            label: `Remove from ${group.name}`,
            onSelect: () => {
              actions.removeSourceFromSubject(source.id, group.id);
              toast(`Removed from ${group.name}`);
            },
          },
        ]),
    { label: "Delete", danger: true, onSelect: () => setDeleting({ source, from: group.id }) },
  ];

  // Arrow keys move through the visible rows and Enter opens one, as in Open
  // Notebook. Fields, menus and dialogs own their keys; buttons own Enter and Space.
  useEffect(() => {
    const onKey = (e) => {
      if (adding || deleting || pickingOpen || rows.length === 0) return;
      const target = e.target.closest ? e.target : null;
      if (target?.closest("input, textarea, select, [role=menu], [role=dialog], dialog")) return;
      // A focused button keeps Enter and Space for itself; arrows still move the selection.
      if ((e.key === "Enter" || e.key === " ") && target?.closest("button")) return;
      const at = rows.indexOf(current);
      if (e.key === "ArrowDown") setSelectedKey(rows[Math.min(at + 1, rows.length - 1)].key);
      else if (e.key === "ArrowUp") setSelectedKey(rows[Math.max(at - 1, 0)].key);
      else if (e.key === "Enter" && current) open({ view: "source", id: current.source.id });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, deleting, pickingOpen, rows, current, open]);

  const allUsed = state.sources.length > 0 && state.sources.every((s) => s.use);
  // Subjects a source being deleted is in besides the group Delete was chosen from.
  const others = deleting
    ? (deleting.source.subjects ?? []).filter((id) => id !== deleting.from).map((id) => state.nodes[id]?.name ?? id)
    : [];
  const addDialog = adding && <AddSourceDialog onDone={() => setAdding(false)} />;

  if (state.sources.length === 0) {
    return (
      <div className="st-src-empty">
        <FileText size={32} aria-hidden="true" />
        <h2>No sources yet</h2>
        <p>Add a link, a file or pasted text you study from.</p>
        <button className="st-src-outline" onClick={() => setAdding(true)}>
          <Plus size={15} aria-hidden="true" /> New source
        </button>
        {addDialog}
      </div>
    );
  }

  return (
    <div className="st-src">
      <header className="st-src-head">
        <div>
          <h1>All sources</h1>
          <p>View all your sources here. You can add new sources or manage existing ones.</p>
        </div>
        <button className="st-src-outline" onClick={() => setAdding(true)}>
          <Plus size={15} aria-hidden="true" /> New source
        </button>
      </header>

      <div className="st-src-table-wrap">
        <div className="st-src-grid">
          <table className="st-src-table st-src-sorts">
            <Cols />
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    className="st-src-check"
                    checked={allUsed}
                    onChange={() => actions.setSourcesUse(state.sources.map((s) => s.id), !allUsed)}
                    aria-label="Use all sources"
                    title="Ticked sources are the ones to use"
                  />
                </th>
                <th><SortHeader field="type" label="Type" sort={sort} onSort={onSort} /></th>
                <th><SortHeader field="title" label="Title" sort={sort} onSort={onSort} /></th>
                <th className="st-src-hide-sm"><SortHeader field="created" label="Created" sort={sort} onSort={onSort} /></th>
                <th className="st-src-hide-sm"><SortHeader field="updated" label="Updated" sort={sort} onSort={onSort} /></th>
                <th className="st-src-right">Actions</th>
              </tr>
            </thead>
          </table>
          {groups.map((group) => (
            <SourceGroup key={group.id} group={group} collapsed={isCollapsed(collapsedMap, group)} onToggle={() => toggle(group)} dropProps={dropProps(group)} over={overId === group.id}>
              {group.sources.map((source) => {
                const key = `${group.id}:${source.id}`;
                return (
                  <SourceRow
                    key={key}
                    source={source}
                    groupId={group.id}
                    selected={current?.key === key}
                    onHover={() => setSelectedKey(key)}
                    onOpen={() => open({ view: "source", id: source.id })}
                    onDelete={(s) => setDeleting({ source: s, from: group.id })}
                    menuItems={menuItems(source, group)}
                    dragProps={dragProps(source, group.id)}
                  />
                );
              })}
            </SourceGroup>
          ))}
        </div>
      </div>

      {addDialog}
      {pickingOpen && <SubjectsDialog sourceId={picking} onDone={() => setPicking(null)} />}
      {deleting && (
        <Dialog title="Delete source" onCancel={() => setDeleting(null)}>
          <p className="st-dialog-text">
            Are you sure you want to delete "{titleOf(deleting.source)}"?
            {others.length > 0 && ` It is also in ${others.join(", ")}.`}
          </p>
          <div className="st-src-dialog-actions">
            <button className="st-ghost-button" onClick={() => setDeleting(null)}>Cancel</button>
            <button
              className="st-danger-button"
              onClick={() => {
                actions.deleteSource(deleting.source.id);
                setDeleting(null);
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
