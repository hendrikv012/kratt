import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { fakeClient, installMemoryLocalStorage, legacyStateWithOnePage, renderAndGetStudy, renderWithProvider, SAMPLE_SNAPSHOT } from "./testing/fakeVault";

// The canvas graph can't draw in the test DOM; stand in a list of its dots.
vi.mock("react-force-graph-2d", () => ({
  default: ({ graphData }) => (
    <ul aria-label="Graph">
      {graphData.nodes.map((n) => (
        <li key={n.id}>{n.label}</li>
      ))}
    </ul>
  ),
}));

const snapshot = SAMPLE_SNAPSHOT;

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("loads the files on start", async () => {
  renderWithProvider(fakeClient(snapshot));
  expect(await screen.findByText("Krebs cycle")).toBeInTheDocument();
});

it("saves typing after a quiet moment, as Markdown", async () => {
  const client = fakeClient(snapshot);
  const { actions } = await renderAndGetStudy(client);
  vi.useFakeTimers();
  act(() => actions.setContent("p1", "<p><strong>New</strong> text.</p>"));
  await act(() => vi.advanceTimersByTimeAsync(900));
  expect(client.calls.at(-1)).toMatchObject({ method: "write", path: "Biology/Cells/Krebs cycle.md" });
  expect(client.calls.at(-1).text).toContain("**New** text.");
});

it("keeps typing safe while the service is away, then saves it", async () => {
  const client = fakeClient(snapshot);
  const { actions } = await renderAndGetStudy(client);
  vi.useFakeTimers();
  client.fail = true;
  act(() => actions.setContent("p1", "<p>Offline typing.</p>"));
  await act(() => vi.advanceTimersByTimeAsync(31000));
  expect(screen.getByText("Study folder not connected. Start it with: memory-engine serve")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("study-vault-pending-v1"))[0].text).toContain("Offline typing.");
  client.fail = false;
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(localStorage.getItem("study-vault-pending-v1")).toBe("[]");
  expect(screen.queryByText(/not connected/)).toBeNull();
});

it("shows the clash notice", async () => {
  const client = fakeClient(snapshot);
  const { actions } = await renderAndGetStudy(client);
  client.setBody("Biology/Cells/Krebs cycle.md", "Changed by hand.\n"); // no event reaches the app yet
  vi.useFakeTimers();
  act(() => actions.setContent("p1", "<p>Mine.</p>"));
  await act(() => vi.advanceTimersByTimeAsync(900));
  expect(screen.getByText(/^Kept both versions: the one on disk is saved as Krebs cycle \(from disk /)).toBeInTheDocument();
});

it("typing kept in the safety copy is saved when the app opens again", async () => {
  const kept = { op: "write", id: "p1", path: "Biology/Cells/Krebs cycle.md", text: "---\nid: p1\ntitle: Krebs cycle\n---\nOffline typing.\n", create: false, base: "v1" };
  localStorage.setItem("study-vault-pending-v1", JSON.stringify([kept]));
  const client = fakeClient(snapshot);
  const { getState } = await renderAndGetStudy(client);
  await waitFor(() => expect(getState().nodes.p1.content).toContain("Offline typing."));
  expect(client.snapshotNow().files.find((f) => f.id === "p1").body).toContain("Offline typing.");
  expect(localStorage.getItem("study-vault-pending-v1")).toBe("[]");
});

it("a kept save whose file changed on disk meanwhile keeps both versions", async () => {
  const kept = { op: "write", id: "p1", path: "Biology/Cells/Krebs cycle.md", text: "---\nid: p1\ntitle: Krebs cycle\n---\nOffline typing.\n", create: false, base: "v1" };
  localStorage.setItem("study-vault-pending-v1", JSON.stringify([kept]));
  const client = fakeClient(snapshot);
  client.setBody("Biology/Cells/Krebs cycle.md", "Changed by hand.\n");
  await renderAndGetStudy(client);
  await waitFor(() => expect(screen.getByText(/^Kept both versions/)).toBeInTheDocument());
  expect(client.snapshotNow().files.find((f) => f.path.includes("(from disk")).body).toBe("Changed by hand.\n");
});

it("a page changed on disk reloads when it has no unsaved typing", async () => {
  const client = fakeClient(snapshot);
  const { getState } = await renderAndGetStudy(client);
  vi.useFakeTimers();
  client.setBody("Biology/Cells/Krebs cycle.md", "Changed by hand.\n");
  act(() => client.emit({ type: "changed", path: "Biology/Cells/Krebs cycle.md" }));
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(getState().nodes.p1.content).toContain("Changed by hand.");
});

it("imports each subject's pages into that subject's folder, even when two subjects share a name", async () => {
  const legacy = legacyStateWithOnePage("Cells", "<p>Cell text.</p>");
  legacy.nodes.s2 = { id: "s2", type: "subject", name: "Legacy", color: "#4c90f0", children: ["pg2"] };
  legacy.nodes.pg2 = { id: "pg2", type: "page", name: "Atoms", content: "<p>Atom text.</p>", mastery: null, home: "s2" };
  legacy.subjects = ["s1", "s2"];
  localStorage.setItem("study-app-data-v1", JSON.stringify(legacy));
  const client = fakeClient({ folders: [], files: [], layout: {} });
  await renderAndGetStudy(client);
  await waitFor(() => expect(client.snapshotNow().files).toHaveLength(2));
  expect(client.snapshotNow().files.map((f) => f.path).sort()).toEqual(["Legacy (2)/Atoms.md", "Legacy/Cells.md"]);
  cleanup();
  const { getState } = await renderAndGetStudy(fakeClient(client.snapshotNow()));
  const state = getState();
  expect(state.subjects.map((id) => state.nodes[id].children.map((child) => state.nodes[child].name))).toEqual([["Cells"], ["Atoms"]]);
});

it("renaming a page, a folder or a subject renames it in the Study folder", async () => {
  const client = fakeClient(SAMPLE_SNAPSHOT);
  const { actions, getState } = await renderAndGetStudy(client);
  const biology = getState().subjects[0];
  act(() => actions.rename("p1", "Citric acid cycle"));
  act(() => actions.rename("Biology/Cells", "Cell parts"));
  act(() => actions.rename(biology, "Life science"));
  await act(() => new Promise((resolve) => setTimeout(resolve, 1200))); // the queue waits 800 ms for quiet
  await waitFor(() => expect(client.snapshotNow().files.map((f) => f.path)).toContain("Life science/Cell parts/Citric acid cycle.md"));
  expect(client.snapshotNow().folders).not.toContain("Biology");
  expect(client.snapshotNow().files).toHaveLength(SAMPLE_SNAPSHOT.files.length);
});

it("imports browser data once on the first start", async () => {
  localStorage.setItem("study-app-data-v1", JSON.stringify(legacyStateWithOnePage("Old page", "<p>Old text.</p>")));
  const client = fakeClient({ folders: [], files: [], layout: {} });
  await renderAndGetStudy(client);
  await waitFor(() => expect(client.calls.some((c) => c.method === "write" && c.text.includes("Old text."))).toBe(true));
  expect(localStorage.getItem("study-app-data-v1")).toBeNull();
  expect(localStorage.getItem("study-app-data-v1-imported")).not.toBeNull();
  cleanup();
  const again = fakeClient(client.snapshotNow());
  await renderAndGetStudy(again);
  expect(again.calls.filter((c) => c.method === "write")).toHaveLength(0);
});

it("saves wait while the copy question is open, and leaving it returns to the old folder", async () => {
  const client = fakeClient(SAMPLE_SNAPSHOT, { folder: "/home/me/Study" });
  const { actions, store } = await renderAndGetStudy(client);
  await act(async () => expect((await store.vault.switchFolder("/home/me/Exams")).empty).toBe(true));
  const asked = client.calls.length;
  act(() => actions.setContent("p1", "<p>Typed while asking.</p>"));
  await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
  expect(client.calls.slice(asked).filter((c) => c.method === "write")).toEqual([]);
  await act(() => store.vault.cancelSwitch());
  expect(client.folderPath).toBe("/home/me/Study");
  await waitFor(() => expect(client.snapshotNow().files.find((f) => f.id === "p1").body).toContain("Typed while asking."), { timeout: 3000 });
});

it("copying pages to a new folder takes what was typed while asking", async () => {
  const client = fakeClient(SAMPLE_SNAPSHOT, { folder: "/home/me/Study" });
  const { actions, store } = await renderAndGetStudy(client);
  await act(() => store.vault.switchFolder("/home/me/Exams"));
  act(() => actions.setContent("p1", "<p>Typed while asking.</p>"));
  act(() => store.vault.copyPagesHere());
  await waitFor(() => expect(client.snapshotNow().files.find((f) => f.id === "p1")?.body).toContain("Typed while asking."), { timeout: 3000 });
  expect(client.folderPath).toBe("/home/me/Exams");
});
