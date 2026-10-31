import { useEffect, useRef, useState } from "react";
import { UNSORTED } from "../data/tree";
import { placementFor, zoneOf } from "./dropZone";

const DRAG_TYPE = "application/x-study-item";
const EXPAND_AFTER = 600;
const SCROLL_EDGE = 32;
const SCROLL_STEP = 8;

// The Unsorted header takes a drop like a row; `placementFor` knows it by this shape.
export const UNSORTED_ROW = { key: `root/${UNSORTED}`, id: UNSORTED, parentId: null, depth: -1, index: 0 };

const same = (a, b) =>
  a === b || (a && b && a.toId === b.toId && a.index === b.index && a.kind === b.kind && a.anchorKey === b.anchorKey && a.side === b.side);

// One drag state for the whole tree, so the highlight and the drop line don't
// flicker as the pointer crosses the children of a row. `scrollRef` is the
// element that scrolls the sidebar.
export function useTreeDrag({ state, actions, scrollRef }) {
  const [dragging, setDragging] = useState(null);
  const [placement, setPlacement] = useState(null);
  // Drop handlers read these, as a drop can arrive before the next render.
  const latest = useRef({});
  latest.current = { state, actions, dragging, placement };

  const update = (next) => {
    latest.current.placement = next;
    setPlacement((old) => (same(old, next) ? old : next));
  };
  const end = () => {
    latest.current.dragging = null;
    setDragging(null);
    update(null);
  };

  // Hovering a closed folder for a moment opens it.
  const hoverId = placement?.kind === "into" && placement.toId !== UNSORTED ? placement.toId : null;
  const closed = hoverId && !state.expanded[hoverId];
  useEffect(() => {
    if (!closed) return;
    const timer = setTimeout(() => latest.current.actions.toggleExpanded(hoverId), EXPAND_AFTER);
    return () => clearTimeout(timer);
  }, [closed, hoverId]);

  const onOver = (row, isContainerRow) => (e) => {
    const { dragging: drag, state: s } = latest.current;
    if (!drag) return;
    const placed = placementFor(s, row, zoneOf(e.currentTarget.getBoundingClientRect(), e.clientY, isContainerRow), drag);
    if (placed) {
      e.preventDefault();
      const link = (e.ctrlKey || e.altKey) && s.nodes[drag.id].type === "page" && placed.kind === "into" && placed.toId !== UNSORTED;
      e.dataTransfer.dropEffect = link ? "copy" : "move";
    } else {
      e.dataTransfer.dropEffect = "none";
    }
    update(placed);
  };

  const onDrop = (e) => {
    const { dragging: drag, placement: to, state: s, actions: a } = latest.current;
    if (!drag || !to) return end();
    e.preventDefault();
    if (s.nodes[drag.id].type === "subject") a.moveSubject(drag.id, to.index);
    else if ((e.ctrlKey || e.altKey) && s.nodes[drag.id].type === "page" && to.kind === "into" && to.toId !== UNSORTED) a.link(drag.id, to.toId);
    else a.moveTo(drag.id, drag.from, to.toId, to.index);
    end();
  };

  const rowProps = (row, isContainerRow) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(DRAG_TYPE, row.id);
      e.dataTransfer.effectAllowed = "copyMove";
      const drag = { id: row.id, from: row.parentId };
      latest.current.dragging = drag;
      setDragging(drag);
    },
    onDragOver: onOver(row, isContainerRow),
    onDragEnd: end,
    onDrop,
    "data-row-key": row.key,
    "data-dragging": (dragging && dragging.id === row.id && dragging.from === row.parentId) || undefined,
    "data-drop": (placement?.kind === "into" && placement.anchorKey === row.key && "into") || undefined,
  });

  const treeProps = {
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) update(null);
    },
    onDragOver: (e) => {
      if (!latest.current.dragging) return;
      // Over a gap between rows nothing would be dropped, so the last line must go.
      if (!e.target.closest("[data-row-key]")) update(null);
      const box = scrollRef?.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      if (e.clientY < rect.top + SCROLL_EDGE) box.scrollTop -= SCROLL_STEP;
      else if (e.clientY > rect.bottom - SCROLL_EDGE) box.scrollTop += SCROLL_STEP;
    },
  };

  const header = rowProps(UNSORTED_ROW, true);
  const unsortedProps = {
    onDragOver: header.onDragOver,
    onDrop: header.onDrop,
    "data-row-key": header["data-row-key"],
    "data-drop": header["data-drop"],
  };

  return { dragging, placement, rowProps, treeProps, unsortedProps };
}
