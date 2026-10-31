import { Maximize2, Plus } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { allPages, UNSORTED } from "../data/tree";
import ForceGraphView from "./ForceGraphView";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const hasGraph = (state) => state.subjects.length > 0 || state.nodes[UNSORTED].children.length > 0;

// A few dots drawn the way the graph draws them: the filled one is a
// subject, the hollow ones are what's inside it, not learned yet.
const SKETCH = {
  dots: [
    { x: 66, y: 36, r: 5.5, subject: true },
    { x: 26, y: 18, r: 3.5 },
    { x: 104, y: 22, r: 3.5 },
    { x: 92, y: 62, r: 3 },
    { x: 4, y: 40, r: 2.5 },
    { x: 128, y: 4, r: 2.5 },
  ],
  links: [[0, 1], [0, 2], [0, 3], [1, 4], [2, 5]],
};

function EmptySketch() {
  const { dots, links } = SKETCH;
  return (
    <svg className="st-home-empty-sketch" viewBox="0 0 132 72" aria-hidden="true">
      {links.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={dots[a].x} y1={dots[a].y} x2={dots[b].x} y2={dots[b].y} />
      ))}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} className={d.subject ? "st-home-empty-subject" : undefined} />
      ))}
    </svg>
  );
}

// Takes the graph's place on Home, centered where the graph will appear.
export function EmptyGraph() {
  const { actions } = useStudy();
  const shell = useShell();
  return (
    <div className="st-graph-empty st-home-empty">
      <EmptySketch />
      <h2>Your subjects will appear here</h2>
      <p className="st-faint">Every subject, folder and page becomes a dot, linked to where it lives.</p>
      <button className="st-button" onClick={() => shell.open({ view: "node", id: actions.addSubject({ palette: shell.palette }), fresh: true })}>
        <Plus size={15} aria-hidden="true" /> Add your first subject
      </button>
    </div>
  );
}

// The graph behind the whole home screen. `fitPadding` keeps the dots
// clear of the widget columns floating on top of it.
export function HomeGraphCanvas({ fitPadding, reduceMotion }) {
  const { graph } = useShell();
  return (
    <div className="st-graph-canvas st-home-graph">
      <ForceGraphView variant="home" settings={{ ...graph, mode: "2d" }} fitPadding={fitPadding} reduceMotion={reduceMotion} />
    </div>
  );
}

// The quiet readout at the top of the home graph.
export function HomeGraphBar() {
  const { state } = useStudy();
  const { open } = useShell();
  const pages = allPages(state);
  const learned = pages.filter((p) => p.mastery !== null).length;
  return (
    <div className="st-graph-bar st-intro-fade">
      <span className="st-graph-count">
        {learned} of {plural(pages.length, "page")} learned
      </span>
      <button className="st-ghost-button" onClick={() => open({ view: "graph" })}>
        <Maximize2 size={14} aria-hidden="true" /> Open graph
      </button>
    </div>
  );
}
