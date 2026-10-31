import { Input } from "../ui/input";
import { useExtensions } from "./ExtensionsProvider.jsx";

// The Extensions tab. There is no catalog to browse yet, so search is off and
// the list is only what is installed.
// What is installed: name and version, or the empty line when nothing is.
// Settings > Extensions shows the same list.
export function InstalledExtensions() {
  const { records } = useExtensions();
  const installed = Object.values(records);
  return installed.length === 0 ? (
    <p className="st-empty">No extensions installed. Installing extensions isn't available yet.</p>
  ) : (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {installed.map((r) => (
        <li key={r.id} className="flex items-baseline gap-2 rounded-st border border-st-border px-3 py-2 text-sm">
          <span className="font-medium">{r.manifest?.name ?? r.id}</span>
          <span className="text-xs text-st-muted-foreground">{r.version}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ExtensionsView() {
  return (
    <article className="st-page">
      <h1 className="st-page-title">Extensions</h1>
      <div className="st-page-meta">
        <span>Extensions add widgets, page blocks, tools and themes to Study.</span>
      </div>
      <Input type="search" disabled placeholder="Search extensions" aria-label="Search extensions" className="mb-4 max-w-sm" />
      <InstalledExtensions />
    </article>
  );
}
