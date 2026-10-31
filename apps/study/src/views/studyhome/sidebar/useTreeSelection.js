import { useEffect, useRef, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { homeOf, isContainer } from "../data/tree";

const keyOf = ({ id, parentId }) => `${parentId ?? "root"}/${id}`;
const elementOf = (key) => [...document.querySelectorAll("[data-row-key]")].find((el) => el.dataset.rowKey === key);

// Which row is selected, and the arrow-key behaviour of the tree (roving
// tabindex: only the selected row, or the first, is a tab stop).
export function useTreeSelection({ state, rows }) {
  const { parents, actions } = useStudy();
  const shell = useShell();
  const [picked, setPicked] = useState(null);
  const lastIndex = useRef(0);
  // Keys of the selected row's ancestors, nearest first, from when it was last visible.
  const ancestors = useRef([]);

  const at = picked ? rows.findIndex((r) => r.key === keyOf(picked)) : -1;
  if (at >= 0) {
    lastIndex.current = at;
    ancestors.current = [];
    let depth = rows[at].depth;
    for (let j = at - 1; j >= 0 && depth > 0; j--) {
      if (rows[j].depth < depth) {
        ancestors.current.push(rows[j].key);
        depth = rows[j].depth;
      }
    }
  }

  // The selected row went away (collapsed parent, delete, move): take its
  // nearest visible ancestor, else the row now at its place, else the one before.
  useEffect(() => {
    if (!picked || at >= 0) return;
    const up = ancestors.current.map((k) => rows.find((r) => r.key === k)).find(Boolean);
    const next = up ?? rows[lastIndex.current] ?? rows[lastIndex.current - 1] ?? null;
    // Only pull focus along when it was in the tree (or lost with the removed row).
    const active = document.activeElement;
    const inside = active === document.body || Boolean(active?.closest?.('[role="tree"]'));
    setPicked(next && { id: next.id, parentId: next.parentId });
    if (next && inside) elementOf(next.key)?.focus();
  }, [picked, at, rows]);

  const select = (row) => {
    setPicked({ id: row.id, parentId: row.parentId });
    elementOf(row.key)?.focus();
  };

  const tabStop = at >= 0 ? at : 0;
  const rowProps = (row) => {
    const node = state.nodes[row.id];
    const container = isContainer(node);
    return {
      role: "treeitem",
      tabIndex: rows[tabStop]?.key === row.key ? 0 : -1,
      "aria-selected": at >= 0 && rows[at].key === row.key,
      "aria-level": row.depth + 1,
      "aria-expanded": container ? Boolean(state.expanded[row.id]) : undefined,
      "data-row-key": row.key,
      // Focus (by click, Tab or script) is what selects; no refocusing needed.
      onFocus: () => setPicked((old) => (old && keyOf(old) === row.key ? old : { id: row.id, parentId: row.parentId })),
    };
  };

  const onTreeKeyDown = (e) => {
    // Only the row itself: not the rename field or the buttons inside a row.
    const el = e.target;
    if (el.getAttribute?.("role") !== "treeitem" || e.ctrlKey || e.altKey || e.metaKey) return;
    const i = rows.findIndex((r) => r.key === el.dataset.rowKey);
    if (i < 0) return;
    const row = rows[i];
    const node = state.nodes[row.id];
    const container = isContainer(node);
    const open = container && state.expanded[row.id];
    const go = (r) => r && select(r);
    switch (e.key) {
      case "ArrowDown": go(rows[i + 1]); break;
      case "ArrowUp": go(rows[i - 1]); break;
      case "Home": go(rows[0]); break;
      case "End": go(rows[rows.length - 1]); break;
      case "ArrowRight":
        if (!container) break;
        if (!open) actions.toggleExpanded(row.id);
        else go(rows[i + 1]?.depth > row.depth ? rows[i + 1] : null);
        break;
      case "ArrowLeft":
        if (open) actions.toggleExpanded(row.id);
        else {
          // The parent is the nearest row above that is shallower.
          let j = i - 1;
          while (j >= 0 && rows[j].depth >= row.depth) j--;
          go(rows[j]);
        }
        break;
      case "Enter":
        shell.open({ view: "node", id: row.id, via: node.type === "page" && homeOf(state, parents, row.id) !== row.parentId ? row.parentId : undefined });
        break;
      case "F2": shell.startRename(row.id); break;
      default: return;
    }
    e.preventDefault();
  };

  return { selected: picked && at >= 0 ? picked : null, select, rowProps, onTreeKeyDown };
}
