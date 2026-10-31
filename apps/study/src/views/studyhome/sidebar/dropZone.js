import { canPlace } from "../data/operations";
import { isContainer, UNSORTED } from "../data/tree";

// Where in a row the pointer is. Containers can also be dropped "into", so
// they get thirds; other rows get halves.
export function zoneOf(rect, clientY, isContainerRow) {
  const y = clientY - rect.top;
  if (!isContainerRow) return y < rect.height / 2 ? "before" : "after";
  if (y < rect.height * 0.25) return "before";
  return y >= rect.height * 0.75 ? "after" : "into";
}

// Where `dragging` ({ id, from }) would land if dropped on `zone` of `row`, or
// null when it can't go there or it would not change anything. `index` is
// counted after the item is taken out of its old list, as moveTo expects.
export function placementFor(state, row, zone, dragging) {
  const node = state.nodes[dragging.id];
  if (!node) return null;

  if (node.type === "subject") {
    if (row.parentId !== null || row.id === UNSORTED || zone === "into") return null;
    const at = state.subjects.indexOf(row.id) + (zone === "after" ? 1 : 0);
    const now = state.subjects.indexOf(dragging.id);
    const index = now < at ? at - 1 : at;
    if (index === now) return null;
    return { toId: null, index, depth: 0, kind: "line", anchorKey: row.key, side: zone };
  }

  let placement;
  if (row.id === UNSORTED) {
    // The header only accepts a drop onto it, whatever part of it is hovered.
    placement = { toId: UNSORTED, index: state.nodes[UNSORTED].children.length, depth: 0, kind: "into", anchorKey: row.key, side: null };
  } else if (zone === "into") {
    if (!isContainer(state.nodes[row.id])) return null;
    placement = { toId: row.id, index: state.nodes[row.id].children.length, depth: row.depth + 1, kind: "into", anchorKey: row.key, side: null };
  } else if (zone === "after" && isContainer(state.nodes[row.id]) && state.expanded[row.id] && state.nodes[row.id].children.length) {
    // The line under an open container is its first slot, not a sibling slot.
    placement = { toId: row.id, index: 0, depth: row.depth + 1, kind: "line", anchorKey: row.key, side: "after" };
  } else {
    placement = { toId: row.parentId, index: row.index + (zone === "after" ? 1 : 0), depth: row.depth, kind: "line", anchorKey: row.key, side: zone };
  }
  if (placement.toId === null) return null; // only subjects live at the top

  if (placement.toId === dragging.from) {
    const list = state.nodes[placement.toId].children;
    const now = list.indexOf(dragging.id);
    if (now < 0) return null;
    if (placement.kind === "into") return null; // already in it
    if (now < placement.index) placement.index -= 1;
    return placement.index === now ? null : placement;
  }
  return canPlace(state, dragging.id, placement.toId) ? placement : null;
}
