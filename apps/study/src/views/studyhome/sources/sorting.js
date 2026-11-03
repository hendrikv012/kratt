import { sourceKind } from "./boxSummary";

export const SORT_OPTIONS = [
  { id: "az", label: "A–Z" }, { id: "za", label: "Z–A" },
  { id: "newest", label: "Newest added" }, { id: "oldest", label: "Oldest added" },
  { id: "updated", label: "Recently updated" }, { id: "type", label: "Type" },
];
export function sortSources(sources, sort = "newest") {
  const title = (a, b) => (a.title || "Untitled source").localeCompare(b.title || "Untitled source");
  const kinds = ["Link", "PDF", "Image", "File", "Text"];
  const comparators = {
    az: title, za: (a, b) => title(b, a),
    newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    type: (a, b) => kinds.indexOf(sourceKind(a)) - kinds.indexOf(sourceKind(b)),
  };
  const compare = comparators[sort] || comparators.newest;
  return [...sources].sort((a, b) => compare(a, b) || title(a, b));
}
