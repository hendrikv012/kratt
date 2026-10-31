import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Plus, Trash2 } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import Dialog from "../dialogs/Dialog";
import AddSourceDialog from "./AddSourceDialog";
import "./sources.css";

// The Sources tab, laid out like Open Notebook's (frontend/src/app/
// (dashboard)/sources/page.tsx): a sortable table of every source with its
// type, title, when it was added and changed, and delete. Study addition:
// a tick for which sources to use.

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
  const { open } = useShell();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [sort, setSort] = useState({ by: "updated", order: "desc" });
  const [selected, setSelected] = useState(0);

  const sources = useMemo(() => {
    const list = [...state.sources].sort(SORTS[sort.by]);
    return sort.order === "desc" ? list.reverse() : list;
  }, [state.sources, sort]);

  const onSort = (by) => {
    setSelected(0);
    setSort((s) => (s.by === by ? { by, order: s.order === "asc" ? "desc" : "asc" } : { by, order: "desc" }));
  };

  // Arrow keys move through the rows and Enter opens one, as in Open Notebook.
  useEffect(() => {
    const onKey = (e) => {
      if (adding || deleting || sources.length === 0 || e.target.closest?.("input, textarea, select")) return;
      if (e.key === "ArrowDown") setSelected((i) => Math.min(i + 1, sources.length - 1));
      else if (e.key === "ArrowUp") setSelected((i) => Math.max(i - 1, 0));
      else if (e.key === "Enter" && sources[selected]) open({ view: "source", id: sources[selected].id });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, deleting, sources, selected, open]);

  const allUsed = sources.length > 0 && sources.every((s) => s.use);
  const addDialog = adding && <AddSourceDialog onDone={() => setAdding(false)} />;

  if (sources.length === 0) {
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
        <table className="st-src-table">
          <colgroup>
            <col className="st-src-col-use" />
            <col className="st-src-col-type" />
            <col />
            <col className="st-src-col-date" />
            <col className="st-src-col-date" />
            <col className="st-src-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="st-src-check"
                  checked={allUsed}
                  onChange={() => actions.setSourcesUse(sources.map((s) => s.id), !allUsed)}
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
          <tbody>
            {sources.map((source, index) => (
              <tr
                key={source.id}
                data-selected={selected === index || undefined}
                onMouseEnter={() => setSelected(index)}
                onClick={() => open({ view: "source", id: source.id })}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="st-src-check"
                    checked={source.use}
                    onChange={() => actions.setSourcesUse([source.id], !source.use)}
                    aria-label={`Use ${titleOf(source)}`}
                  />
                </td>
                <td>
                  <span className="st-src-type">
                    <span className="st-src-dot" data-type={source.type} aria-hidden="true" />
                    {TYPE_NAMES[source.type]}
                  </span>
                </td>
                <td>
                  <span className="st-src-title">{titleOf(source)}</span>
                  {source.url && <span className="st-src-url">{source.url}</span>}
                </td>
                <td className="st-src-muted st-src-hide-sm">{ago(source.createdAt)}</td>
                <td className="st-src-muted st-src-hide-sm">{ago(source.updatedAt)}</td>
                <td className="st-src-right">
                  <button
                    className="st-icon-button st-src-delete"
                    aria-label={`Delete ${titleOf(source)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(source);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addDialog}
      {deleting && (
        <Dialog title="Delete source" onCancel={() => setDeleting(null)}>
          <p className="st-dialog-text">Are you sure you want to delete "{titleOf(deleting)}"?</p>
          <div className="st-src-dialog-actions">
            <button className="st-ghost-button" onClick={() => setDeleting(null)}>Cancel</button>
            <button
              className="st-danger-button"
              onClick={() => {
                actions.deleteSource(deleting.id);
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
