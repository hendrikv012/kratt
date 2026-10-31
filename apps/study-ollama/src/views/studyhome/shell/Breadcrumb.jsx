import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { pathTo } from "../data/tree";

// The path to a page or folder, shown above its title. Each step opens that item.
export default function Breadcrumb({ id }) {
  const { state, parents } = useStudy();
  const shell = useShell();
  if (!state.nodes[id]) return null;
  const via = shell.route.view === "node" && shell.route.id === id ? shell.route.via : undefined;
  const trail = [...pathTo(state, parents, id, via), id];
  return (
    <nav aria-label="Breadcrumb" className="st-crumbs st-crumbs-page">
      <span className="st-subject-mark" style={{ background: state.nodes[trail[0]].color }} aria-hidden="true" />
      {trail.map((step, i) => (
        <span key={step} className="st-crumb">
          {i > 0 && <span className="st-faint">/</span>}
          <button onClick={() => shell.open({ view: "node", id: step })}>{state.nodes[step].name}</button>
        </span>
      ))}
    </nav>
  );
}
