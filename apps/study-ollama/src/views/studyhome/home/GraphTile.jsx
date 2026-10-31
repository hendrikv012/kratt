import { useStudy } from "../data/StudyProvider";
import { EmptyGraph, hasGraph, HomeGraphBar, HomeGraphCanvas } from "../graph/HomeGraph";

// Home's graph, fitted inside its tile. Hovering it gives the legend's hint.
export default function GraphTile() {
  const { state } = useStudy();
  return (
    <div className="st-graph-tile" title="Brighter is better known">
      {hasGraph(state) ? (
        <>
          <HomeGraphBar />
          <HomeGraphCanvas fitPadding={0} />
        </>
      ) : (
        <EmptyGraph />
      )}
    </div>
  );
}
