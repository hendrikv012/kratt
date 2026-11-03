// What an artifact was made from, for the chips and the line under its title.

// One chip per id in `ids`. A subject or folder stands for every page inside it.
export function madeFromChips(state, ids) {
  return ids.map((id) => {
    const node = state.nodes[id];
    if (node?.type === "page") return { id, label: node.name || "Untitled", kind: "page" };
    if (node) return { id, label: node.name || "Untitled", kind: "subject" };
    const source = state.sources?.find((s) => s.id === id);
    if (source) return { id, label: source.title || "Untitled source", kind: "source" };
    return { id, label: "deleted note", kind: "missing" };
  });
}

export function coverageLine({ madeFrom, parts }) {
  const n = madeFrom.length;
  const all = n === 1 ? "all of it" : "all of them";
  const split = parts > 1 ? `, in ${parts} parts` : "";
  return `Made from ${n} ${n === 1 ? "note" : "notes"} · ${all}${split}`;
}
