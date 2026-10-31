import { subjectOf, parentIndex, UNSORTED } from "../data/tree";

// Where Ctrl+V puts a copy: { toId, index } for `duplicate`, or null if the
// copied item is gone. `selection.parentId` is the list the row is shown in,
// which for a page may not be its home, so "right after" uses that.
export function pasteTarget(state, copied, selection) {
  if (!state.nodes[copied.id]) return null;
  const selected = selection && state.nodes[selection.id] ? selection : null;
  const loose = !selected || selected.id === UNSORTED || subjectOf(state, parentIndex(state), selected.id) === UNSORTED;
  const end = { toId: UNSORTED, index: state.nodes[UNSORTED].children.length };

  if (state.nodes[copied.id].type === "subject") {
    if (loose) return { toId: null, index: state.subjects.length };
    const subject = subjectOf(state, parentIndex(state), selected.id);
    return { toId: null, index: state.subjects.indexOf(subject) + 1 };
  }

  if (!selected || selected.id === UNSORTED) return end;
  const node = state.nodes[selected.id];
  if (node.type !== "page") return { toId: node.id, index: node.children.length };
  const list = state.nodes[selection.parentId];
  if (!list) return end;
  const at = list.children.indexOf(node.id);
  return { toId: list.id, index: at < 0 ? list.children.length : at + 1 };
}
