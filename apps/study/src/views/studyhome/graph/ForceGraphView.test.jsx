import { it, expect, vi, beforeEach } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import { render, act, waitFor } from "@testing-library/react";

// Stand in for the canvas graph: record what it's given and what's asked of it.
const graph = { props: null, calls: [], forcesWhenDataArrived: null, zoomMs: [] };
vi.mock("react-force-graph-2d", () => ({
  default: forwardRef(function FakeGraph(props, ref) {
    graph.props = props;
    if (props.graphData.nodes.length && graph.forcesWhenDataArrived === null) graph.forcesWhenDataArrived = [...graph.calls];
    useImperativeHandle(ref, () => ({
      d3Force: (name, force) => {
        if (force) graph.calls.push(name);
        return name === "link" ? { distance: () => {}, strength: () => {} } : undefined;
      },
      d3ReheatSimulation: () => graph.calls.push("reheat"),
      getGraphBbox: () => ({ x: [-100, 100], y: [-50, 50] }),
      centerAt: () => graph.calls.push("centerAt"),
      zoom: (z, ms) => {
        graph.calls.push("zoom");
        graph.zoomMs.push(ms);
      },
      zoomToFit: () => graph.calls.push("zoomToFit"),
    }));
    return null;
  }),
}));

import ForceGraphView from "./ForceGraphView";
import { StudyProvider, useStudy } from "../data/StudyProvider";
import { EMPTY_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";
import { GRAPH_DEFAULTS } from "../useSettings";

beforeEach(() => {
  graph.calls = [];
  graph.zoomMs = [];
  graph.forcesWhenDataArrived = null;
  const store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
});

async function setup(open = () => {}, { appReduceMotion = false } = {}) {
  let api;
  function Seed() {
    api = useStudy();
    return null;
  }
  render(
    <StudyProvider client={fakeClient(EMPTY_SNAPSHOT)}>
      <ShellContext.Provider value={{ open }}>
        <Seed />
        <div className="study" data-reduce-motion={appReduceMotion || undefined}>
          <ForceGraphView variant="home" settings={GRAPH_DEFAULTS} fitPadding={300} />
        </div>
      </ShellContext.Provider>
    </StudyProvider>
  );
  await waitFor(() => {
    if (!api) throw new Error("the Study folder isn't open yet");
  });
  act(() => {
    api.actions.addSubject({ name: "Biology" });
    api.actions.addQuickNote("Ask about mitosis");
  });
}

it("sets Lokus's forces before any dots go in, then fits at once", async () => {
  await setup();
  expect(graph.forcesWhenDataArrived).toEqual(expect.arrayContaining(["charge", "center", "collision"]));
  act(() => graph.props.onEngineTick());
  expect(graph.calls).toContain("zoom");
});

it("a quick note's dot opens Quick notes; other dots open the item", async () => {
  const open = vi.fn();
  await setup(open);
  const note = graph.props.graphData.nodes.find((n) => n.kind === "note");
  const subject = graph.props.graphData.nodes.find((n) => n.kind === "subject");
  act(() => graph.props.onNodeClick(note, {}));
  expect(open).toHaveBeenLastCalledWith({ view: "quick-notes" });
  act(() => graph.props.onNodeClick(subject, {}));
  expect(open).toHaveBeenLastCalledWith({ view: "node", id: subject.id });
});

it("draws dots and links in the theme's graph colors and follows a theme change", async () => {
  const root = document.documentElement.style;
  root.setProperty("--st-c-graph-node", "0 0% 94.1%");
  root.setProperty("--st-c-graph-link", "0 0% 0%");
  root.setProperty("--st-c-graph-link-alpha", "0.25");
  try {
    await setup();
    const subject = graph.props.graphData.nodes.find((n) => n.kind === "subject");
    expect(graph.props.nodeColor(subject)).toBe("#f0f0f0");
    expect(graph.props.linkColor({ source: "a", target: "b" })).toBe("#00000040");
    act(() => root.setProperty("--st-c-graph-node", "120 100% 25%"));
    await waitFor(() => expect(graph.props.nodeColor(subject)).toBe("#008000"));
  } finally {
    ["--st-c-graph-node", "--st-c-graph-link", "--st-c-graph-link-alpha"].forEach((k) => root.removeProperty(k));
  }
});

it("the app's Reduce motion setting makes every re-fit instant", async () => {
  await setup(() => {}, { appReduceMotion: true });
  act(() => graph.props.onEngineTick());
  act(() => graph.props.onEngineStop());
  expect(graph.zoomMs.length).toBeGreaterThanOrEqual(2);
  expect(graph.zoomMs.every((ms) => ms === 0)).toBe(true);
});

it("without reduced motion the settled re-fit glides", async () => {
  await setup();
  act(() => graph.props.onEngineTick());
  act(() => graph.props.onEngineStop());
  expect(graph.zoomMs.at(-1)).toBe(500);
});
