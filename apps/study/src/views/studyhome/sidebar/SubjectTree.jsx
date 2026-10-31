import { useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardPaste, Copy, ChevronRight, FilePlus, FileText, Folder, FolderPlus, Link2, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import Menu from "./Menu";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { homeOf, isContainer, UNSORTED } from "../data/tree";
import { keysOf, matches } from "../shortcuts";
import { pasteTarget } from "./pasteTarget";
import { useTreeDrag } from "./useTreeDrag";
import { useTreeSelection } from "./useTreeSelection";
import { visibleRows } from "./treeRows";

const typingPlace = (el) => Boolean(el?.closest?.("input, textarea, [contenteditable]:not([contenteditable='false'])"));

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

// One item in the tree. `parentId` is the container it's shown under: a
// page linked into several folders appears once under each.
function TreeItem({ id, parentId, depth, index, drag, sel, clip }) {
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
    ...(node.type === "page" || node.type === "subject"
      ? [
          shell.tabPins?.has(`node:${id}`)
            ? { label: "Unpin from tab bar", icon: <PinOff size={14} />, onSelect: () => shell.tabPins.unpin(`node:${id}`) }
            : { label: "Pin to tab bar", icon: <Pin size={14} />, onSelect: () => shell.tabPins?.pin(`node:${id}`) },
        ]
      : []),
    { label: "Copy", icon: <Copy size={14} />, hint: keysOf(shell.shortcuts, "sidebar.copy"), onSelect: () => clip.copy({ id, parentId }) },
    {
      label: "Paste",
      icon: <ClipboardPaste size={14} />,
      hint: keysOf(shell.shortcuts, "sidebar.paste"),
      disabled: !shell.clipboard,
      onSelect: () => clip.paste({ id, parentId }),
    },
    { label: "Delete…", icon: <Trash2 size={14} />, danger: true, hint: keysOf(shell.shortcuts, "sidebar.delete"), onSelect: () => shell.askDelete(id, parentId) },
  ];

  const groupId = `st-group-${parentId ?? "root"}-${id}`;
  const hasGroup = open && node.children.length > 0;
  const row = { key: `${parentId ?? "root"}/${id}`, id, parentId, depth, index };

  const Icon = node.type === "folder" ? Folder : FileText;

  return (
    <li role="none">
      <div
        className="st-tree-row"
        data-tree-id={id}
        data-parent-id={parentId ?? undefined}
        style={{ paddingLeft: 6 + depth * 14 }}
        aria-current={current ? "page" : undefined}
        {...drag.rowProps(row, container)}
        {...sel.rowProps(row)}
        aria-owns={hasGroup ? groupId : undefined}
        draggable={shell.renamingId !== id}
        onClick={() => {
          sel.select(row);
          shell.open({ view: "node", id, via: linkedHere ? parentId : undefined });
        }}
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
      {hasGroup && (
        <ul id={groupId} className="st-tree" role="group">
          {node.children.map((childId, i) => (
            <TreeItem key={childId} id={childId} parentId={id} depth={depth + 1} index={i} drag={drag} sel={sel} clip={clip} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Things that belong to no subject. Shown when something is in it, or while
// dragging so things can be dropped there.
function UnsortedSection({ drag, sel, clip }) {
  const { state } = useStudy();
  const shell = useShell();
  const children = state.nodes[UNSORTED].children;
  if (children.length === 0 && !drag.dragging) return null;
  return (
    <>
      <div
        className="st-side-section st-side-section-row st-unsorted-head"
        role="none"
        aria-current={shell.route.view === "node" && shell.route.id === UNSORTED ? "page" : undefined}
        onClick={() => shell.open({ view: "node", id: UNSORTED })}
        {...drag.unsortedProps}
      >
        <span>Unsorted</span>
      </div>
      <ul className="st-tree" role="group">
        {children.map((id, i) => (
          <TreeItem key={id} id={id} parentId={UNSORTED} depth={0} index={i} drag={drag} sel={sel} clip={clip} />
        ))}
      </ul>
    </>
  );
}

export default function SubjectTree() {
  const { state, actions } = useStudy();
  const shell = useShell();
  // The sidebar is what scrolls; the wrapper is the line's positioning box.
  const treeRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current = treeRef.current?.closest(".st-sidebar") ?? null;
  }, []);
  const drag = useTreeDrag({ state, actions, scrollRef });
  const rows = visibleRows(state);
  const sel = useTreeSelection({ state, rows });
  const { placement, dragging } = drag;

  // Copy and paste, from the keys and from the row menus. Both take the row
  // they act on: { id, parentId }.
  const [pasted, setPasted] = useState(null);
  const clip = {
    copy: (at) => {
      const node = state.nodes[at?.id];
      if (!node || at.id === UNSORTED) return false;
      shell.setClipboard({ id: at.id, parentId: at.parentId });
      shell.toast(`Copied "${node.name}"`);
      return true;
    },
    paste: (at) => {
      if (!shell.clipboard) return false;
      const target = pasteTarget(state, shell.clipboard, at);
      if (!target) {
        shell.toast("The copied item was deleted");
        return true;
      }
      const { id: from, parentId } = shell.clipboard;
      const id = actions.duplicate(from, parentId, target.toId, target.index, { palette: shell.palette });
      if (id) setPasted({ id, parentId: target.toId });
      return true;
    },
  };
  // The copy only has a row once the tree has drawn it.
  useEffect(() => {
    if (!pasted) return;
    const row = rows.find((r) => r.id === pasted.id && r.parentId === pasted.parentId);
    if (row) sel.select(row);
    setPasted(null);
  }, [pasted, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    sel.onTreeKeyDown(e);
    if (e.defaultPrevented || typingPlace(e.target) || !sel.selected) return;
    const { shortcuts } = shell;
    const act = matches(e, shortcuts, "sidebar.copy")
      ? () => clip.copy(sel.selected)
      : matches(e, shortcuts, "sidebar.paste")
        ? () => clip.paste(sel.selected)
        : matches(e, shortcuts, "sidebar.delete")
          ? () => shell.askDelete(sel.selected.id, sel.selected.parentId)
          : null;
    if (!act) return;
    if (act() !== false) e.preventDefault();
  };
  let line = null;
  if (placement?.kind === "line") {
    const anchor = [...(treeRef.current?.querySelectorAll("[data-row-key]") ?? [])].find((el) => el.dataset.rowKey === placement.anchorKey);
    if (anchor) line = { top: anchor.offsetTop + (placement.side === "after" ? anchor.offsetHeight : 0), left: 6 + placement.depth * 14 };
  }

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
      {/* One tree for both lists, so arrows cross from the last subject into Unsorted. */}
      <div
        ref={treeRef}
        className="st-tree-area"
        role={rows.length ? "tree" : undefined}
        aria-label={rows.length ? "Subjects" : undefined}
        onKeyDown={onKeyDown}
        {...drag.treeProps}
      >
        {state.subjects.length === 0 ? (
          <button className="st-side-row st-faint" onClick={() => shell.startRename(actions.addSubject({ palette: shell.palette }))}>
            <span className="st-side-chevron" />
            <Plus size={14} aria-hidden="true" />
            New subject
          </button>
        ) : (
          <ul className="st-tree" role="group">
            {state.subjects.map((id, i) => (
              <TreeItem key={id} id={id} parentId={null} depth={0} index={i} drag={drag} sel={sel} clip={clip} />
            ))}
          </ul>
        )}
        <UnsortedSection drag={drag} sel={sel} clip={clip} />
        {line && <div className="st-drop-line" style={line} aria-hidden="true" />}
      </div>
      {dragging && (
        <p className="st-drag-hint">
          Drop between items to move, onto a folder to put it inside.
          {state.nodes[dragging.id].type === "page" && " Hold Ctrl to also keep a page where it is."}
        </p>
      )}
    </>
  );
}
