import { it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor, screen, fireEvent, within } from "@testing-library/react";

// Lokus's editor rebuilds itself whenever onContentChange changes, which
// loses focus and drops keystrokes. Capture what the page passes it.
const received = [];
vi.mock("../../../editor/components/Editor.jsx", () => ({
  default: (props) => {
    received.push(props.onContentChange);
    return null;
  },
}));

vi.mock("../graph/ForceGraphView", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

import PageView from "./PageView";
import { StudyProvider, useStudy } from "../data/StudyProvider";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, SAMPLE_SNAPSHOT, fakeClient, openKrebs } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";

beforeEach(() => {
  received.length = 0;
  const store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
});

it("gives the editor the same change handler while typing, so it isn't rebuilt", async () => {
  let api;
  function Harness() {
    api = useStudy();
    const pageId = api.state.subjects.length ? api.state.nodes[api.state.subjects[0]].children[0] : null;
    return pageId ? <PageView id={pageId} /> : null;
  }
  const shell = { open() {}, askLink() {}, palette: [], graph: {}, route: { view: "home" } };
  render(
    <StudyProvider client={fakeClient(EMPTY_SNAPSHOT)}>
      <ShellContext.Provider value={shell}>
        <Harness />
      </ShellContext.Provider>
    </StudyProvider>
  );
  await waitFor(() => {
    if (!api) throw new Error("the Study folder isn't open yet");
  });
  act(() => {
    const subject = api.actions.addSubject({ name: "Bio" });
    api.actions.addChild(subject, "page", "Cells");
  });
  const pageId = api.state.nodes[api.state.subjects[0]].children[0];
  act(() => received.at(-1)("<p>a</p>"));
  act(() => received.at(-1)("<p>ab</p>"));

  expect(api.state.nodes[pageId].content).toBe("<p>ab</p>");
  expect(new Set(received).size).toBe(1);
});

it("pins and unpins a page from its own menu", async () => {
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
  render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
  const side = within(await screen.findByRole("navigation", { name: "Sidebar" }));
  await openKrebs(side);
  expect(side.queryByText("Pinned")).toBeNull();

  const header = () => screen.getByRole("textbox", { name: /title/i }).closest("header");
  await screen.findByRole("textbox", { name: /title/i });
  fireEvent.contextMenu(header());
  fireEvent.click(await screen.findByRole("menuitem", { name: "Pin to sidebar" }));
  expect(side.getByRole("link", { name: "Krebs cycle" })).toBeTruthy();

  fireEvent.contextMenu(header());
  fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin" }));
  expect(side.queryByRole("link", { name: "Krebs cycle" })).toBeNull();
});

it("right-clicking the title keeps the browser's own menu", async () => {
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
  render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
  await openKrebs(within(await screen.findByRole("navigation", { name: "Sidebar" })));

  const notPrevented = fireEvent.contextMenu(await screen.findByRole("textbox", { name: /title/i }));
  expect(notPrevented).toBe(true);
  expect(screen.queryByRole("menu")).toBeNull();
});
