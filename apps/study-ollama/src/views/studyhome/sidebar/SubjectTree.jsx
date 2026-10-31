import { useState } from "react";
import { ChevronDown, ChevronRight, FilePlus, FileText, Folder, FolderPlus, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Menu from "./Menu";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { canPlace } from "../data/operations";
import { homeOf, isContainer, UNSORTED } from "../data/tree";

const DRAG_TYPE = "application/x-study-item";

function RenameInput({ id, name }) {
  const { actions } = useStudy();
  const { stopRename } = useShell();
  const [value, setValue] = useState(name);
  const commit = () => {
    actions.rename(id, value);
    stopRename();
  };
  return (
    <input
      className="st-tree-rename"
      autoFocus
      value={value}
      aria-label="Name"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") stopRename();
      }}
    />
  );
}

function ColorPicker({ id }) {
  const { state, actions } = useStudy();
  const { palette } = useShell();
  return (
    <div className="st-menu-colors" role="group" aria-label="Subject color">
      {palette.map((color) => (
        <button
          key={color}
          aria-label={`Color ${color}`}
          aria-pressed={state.nodes[id].color === color}
          style={{ background: color }}
          onClick={(e) => {
            e.stopPropagation();
            actions.setColor(id, color);
          }}
        />
      ))}
    </div>
  );
}

// Lets a subject, folder or Unsorted take a drop: move the dragged item
// there, or with Ctrl/Alt held, put a page there as well.
function useDropTarget(targetId, dragging, setDragging) {
  const { state, actions } = useStudy();
  const [over, setOver] = useState(false);
  if (!targetId) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragOver: (e) => {
        if (!dragging || !canPlace(state, dragging.id, targetId)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e) => {
        e.preventDefault();
        setOver(false);
        const linkInstead = (e.ctrlKey || e.altKey) && state.nodes[dragging.id].type === "page" && targetId !== UNSORTED;
        if (linkInstead) actions.link(dragging.id, targetId);
        else actions.move(dragging.id, dragging.from, targetId);
        setDragging(null);
      },
    },
  };
}

// One item in the tree. `parentId` is the container it's shown under: a
// page linked into several folders appears once under each.
function TreeItem({ id, parentId, depth, dragging, setDragging }) {
  const { state, parents, actions } = useStudy();
  const shell = useShell();
  const node = state.nodes[id];
  const container = isContainer(node);
  const open = container && state.expanded[id];
  const linkedHere = node.type === "page" && homeOf(state, parents, id) !== parentId;
  const current = shell.route.view === "node" && shell.route.id === id && (shell.route.via ?? homeOf(state, parents, id)) === parentId;

  const create = (type) => {
    const newId = actions.addChild(id, type);
    shell.startRename(newId);
    if (type === "page") shell.open({ view: "node", id: newId });
  };

  const menuItems = [
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => shell.startRename(id) },
    ...(node.type === "subject" ? [{ key: "colors", custom: <ColorPicker id={id} /> }] : []),
    ...(node.type === "page"
      ? [{ label: "Also put in another folder…", icon: <Link2 size={14} />, onSelect: () => shell.askLink(id) }]
      : []),
    { label: "Delete…", icon: <Trash2 size={14} />, danger: true, onSelect: () => shell.askDelete(id, parentId) },
  ];

  const dropProps = useDropTarget(container ? id : null, dragging, setDragging);

  const Icon = node.type === "folder" ? Folder : FileText;

  return (
    <li>
      <div
        className="st-tree-row"
        style={{ paddingLeft: 6 + depth * 14 }}
        aria-current={current ? "page" : undefined}
        data-drop={dropProps.over || undefined}
        draggable={node.type !== "subject" && shell.renamingId !== id}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, id);
          e.dataTransfer.effectAllowed = "copyMove";
          setDragging({ id, from: parentId });
        }}
        onDragEnd={() => setDragging(null)}
        onClick={() => shell.open({ view: "node", id, via: linkedHere ? parentId : undefined })}
        {...dropProps.handlers}
      >
        <button
          className="st-tree-chevron"
          aria-label={open ? "Collapse" : "Expand"}
          tabIndex={container ? 0 : -1}
          style={{ visibility: container && node.children.length ? "visible" : "hidden" }}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleExpanded(id);
          }}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {node.type === "subject" ? (
          <span className="st-subject-mark" style={{ background: node.color }} aria-hidden="true" />
        ) : (
          <Icon size={14} className="st-faint" aria-hidden="true" />
        )}
        {shell.renamingId === id ? (
          <RenameInput id={id} name={node.name} />
        ) : (
          <span className="st-truncate st-tree-name">{node.name}</span>
        )}
        {linkedHere && <Link2 size={12} className="st-faint" aria-label="Linked from another folder" />}
        <span className="st-tree-actions">
          {container && (
            <Menu
              label={`Add to ${node.name}`}
              icon={<Plus size={14} />}
              items={[
                { label: "New folder", icon: <FolderPlus size={14} />, onSelect: () => create("folder") },
                { label: "New page", icon: <FilePlus size={14} />, onSelect: () => create("page") },
              ]}
            />
          )}
          <Menu label={`More for ${node.name}`} icon={<MoreHorizontal size={14} />} items={menuItems} />
        </span>
      </div>
      {open && node.children.length > 0 && (
        <ul className="st-tree">
          {node.children.map((childId) => (
            <TreeItem key={childId} id={childId} parentId={id} depth={depth + 1} dragging={dragging} setDragging={setDragging} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Things that belong to no subject. Shown when something is in it, or while
// dragging so things can be dropped there.
function UnsortedSection({ dragging, setDragging }) {
  const { state } = useStudy();
  const shell = useShell();
  const children = state.nodes[UNSORTED].children;
  const drop = useDropTarget(UNSORTED, dragging, setDragging);
  if (children.length === 0 && !dragging) return null;
  return (
    <>
      <div
        className="st-side-section st-side-section-row st-unsorted-head"
        data-drop={drop.over || undefined}
        aria-current={shell.route.view === "node" && shell.route.id === UNSORTED ? "page" : undefined}
        onClick={() => shell.open({ view: "node", id: UNSORTED })}
        {...drop.handlers}
      >
        <span>Unsorted</span>
      </div>
      <ul className="st-tree">
        {children.map((id) => (
          <TreeItem key={id} id={id} parentId={UNSORTED} depth={0} dragging={dragging} setDragging={setDragging} />
        ))}
      </ul>
    </>
  );
}

export default function SubjectTree() {
  const { state, actions } = useStudy();
  const shell = useShell();
  const [dragging, setDragging] = useState(null);

  return (
    <>
      <div className="st-side-section st-side-section-row">
        <span>Subjects</span>
        <button
          className="st-icon-button st-tree-action st-tree-action-visible"
          aria-label="New subject"
          onClick={() => shell.startRename(actions.addSubject({ palette: shell.palette }))}
        >
          <Plus size={14} />
        </button>
      </div>
      {state.subjects.length === 0 ? (
        <button className="st-side-row st-faint" onClick={() => shell.startRename(actions.addSubject({ palette: shell.palette }))}>
          <span className="st-side-chevron" />
          <Plus size={14} aria-hidden="true" />
          New subject
        </button>
      ) : (
        <ul className="st-tree">
          {state.subjects.map((id) => (
            <TreeItem key={id} id={id} parentId={null} depth={0} dragging={dragging} setDragging={setDragging} />
          ))}
        </ul>
      )}
      <UnsortedSection dragging={dragging} setDragging={setDragging} />
      {dragging && (
        <p className="st-drag-hint">
          Drop on a subject or folder to move it there.
          {state.nodes[dragging.id].type === "page" && " Hold Ctrl to put the page there as well."}
        </p>
      )}
    </>
  );
}
