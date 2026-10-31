import { isContainer, UNSORTED } from "../data/tree";

// The rows the sidebar tree shows, top to bottom: subjects, then Unsorted's
// children. A container's children appear only while it is expanded. `key`
// tells apart a page that is listed in several places.
export function visibleRows(state) {
  const rows = [];
  const walk = (ids, parentId, depth) =>
    ids.forEach((id, index) => {
      rows.push({ key: `${parentId ?? "root"}/${id}`, id, parentId, depth, index });
      const node = state.nodes[id];
      if (node && isContainer(node) && state.expanded[id]) walk(node.children, id, depth + 1);
    });
  walk(state.subjects, null, 0);
  walk(state.nodes[UNSORTED]?.children ?? [], UNSORTED, 0);
  return rows;
}
