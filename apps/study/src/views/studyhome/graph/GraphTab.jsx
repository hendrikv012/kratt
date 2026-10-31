import { useEffect, useMemo, useRef, useState } from "react";
import GraphSidebar from "../../../components/GraphSidebar.jsx";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { lokusGraph } from "../data/graphData";
import ForceGraphView, { MASTERY_SCHEME } from "./ForceGraphView";

// The Graph tab, laid out like Lokus's graph view: the whole graph, with
// Lokus's own Graph Settings panel (components/GraphSidebar.jsx) beside it.
export default function GraphTab() {
  const { state, parents } = useStudy();
  const { graph, setGraph } = useShell();
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(2000);
  const api = useRef(null);

  const graphData = useMemo(() => lokusGraph(state, parents), [state, parents]);
  const stats = useMemo(
    () => ({
      nodeCount: graphData.nodes.length,
      linkCount: graphData.links.length,
      wikiLinkCount: graphData.links.filter((l) => l.kind === "wiki").length,
      placeholderCount: graphData.nodes.filter((n) => n.type === "placeholder").length,
    }),
    [graphData]
  );

  // Lokus's animation tour: visits each dot in turn.
  useEffect(() => {
    if (!isAnimating || graphData.nodes.length === 0) return;
    let index = 0;
    const visit = () => {
      api.current?.focusNode(graphData.nodes[index % graphData.nodes.length].id);
      index += 1;
    };
    visit();
    const timer = setInterval(visit, animationSpeed);
    return () => clearInterval(timer);
  }, [isAnimating, animationSpeed, graphData]);

  if (state.subjects.length === 0 && state.nodes.unsorted.children.length === 0 && state.quickNotes.length === 0) {
    return (
      <div className="st-fgraph-tab st-fgraph-tab-empty">
        <p className="st-empty">Add a subject in the sidebar and it shows up here.</p>
      </div>
    );
  }

  return (
    <div className="st-fgraph-tab">
      <div className="st-graph-canvas">
        <ForceGraphView
          variant="full"
          settings={graph}
          selectedNodes={selectedNodes}
          onSelectedNodes={setSelectedNodes}
          onHoveredNode={setHoveredNode}
          apiRef={api}
        />
      </div>
      <aside className="st-graph-settings" aria-label="Graph settings">
        <GraphSidebar
          selectedNodes={selectedNodes}
          hoveredNode={hoveredNode}
          graphData={graphData}
          stats={stats}
          config={graph}
          onConfigChange={setGraph}
          onNodeClick={(node) => api.current?.focusNode(node.id)}
          isAnimating={isAnimating}
          animationSpeed={animationSpeed}
          onToggleAnimation={() => setIsAnimating((a) => !a)}
          onAnimationSpeedChange={setAnimationSpeed}
          extraColorSchemes={[MASTERY_SCHEME]}
        />
      </aside>
    </div>
  );
}
