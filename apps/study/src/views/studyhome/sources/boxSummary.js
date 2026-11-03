export const BOX_STYLES = [
  { value: "rich", label: "Rich box" },
  { value: "simple", label: "Simple box" },
  { value: "preview", label: "Preview box" },
  { value: "list", label: "List" },
];

export function sourceKind(source) {
  if (source.type === "file" && /\.pdf$/i.test(source.fileName || source.file || "")) return "PDF";
  return { link: "Link", file: "File", text: "Text" }[source.type] || "File";
}

export function typeSummary(sources) {
  const counts = new Map();
  for (const source of sources) {
    const kind = sourceKind(source);
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${kind === "PDF" ? "PDF" : kind.toLowerCase()}${n === 1 || kind === "Text" ? "" : "s"}`).join(" · ");
}

export function sourcePreview(source) {
  // Text only: source HTML and Markdown are never inserted as markup.
  return source.content?.trim().slice(0, 280) || source.url || source.fileName || "No text available yet. Open the source for details.";
}
