import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudyPreview from "./StudyPreview";
import { fakeClient, installMemoryLocalStorage, SAMPLE_SNAPSHOT } from "./data/testing/fakeVault";

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
  window.history.replaceState(null, "", "/?view=study-preview");
});

afterEach(() => cleanup());

async function renderSettingsWithProvider(client) {
  window.history.replaceState(null, "", "/?view=study-preview&settings=data");
  render(<StudyPreview client={client} />);
  await screen.findByRole("dialog", { name: "Settings" });
}

async function renderAddSourceWithProvider(client) {
  render(<StudyPreview client={client} />);
  const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
  fireEvent.click(within(sidebar).getByText("Sources"));
  fireEvent.click(screen.getByRole("button", { name: /New source/ }));
  const dialog = screen.getByRole("dialog", { name: "Add source" });
  fireEvent.click(within(dialog).getByRole("tab", { name: /Upload file/ }));
}

async function uploadFile(file) {
  const dialog = screen.getByRole("dialog", { name: "Add source" });
  fireEvent.change(dialog.querySelector('input[type="file"]'), { target: { files: [file] } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
  });
}

it("switches the Study folder from Settings", async () => {
  const client = fakeClient(snapshot, { folder: "/home/me/Study" });
  await renderSettingsWithProvider(client);
  const field = await screen.findByLabelText("Study folder");
  expect(field).toHaveValue("/home/me/Study");
  await userEvent.clear(field);
  await userEvent.type(field, "/home/me/Exams");
  await userEvent.click(screen.getByRole("button", { name: "Use this folder" }));
  expect(client.calls).toContainEqual({ method: "setFolder", path: "/home/me/Exams" });
});

it("keeps the original file of an uploaded source", async () => {
  const client = fakeClient(snapshot);
  await renderAddSourceWithProvider(client);
  await uploadFile(new File(["hello"], "notes.txt", { type: "text/plain" }));
  await waitFor(() => expect(client.calls).toContainEqual(expect.objectContaining({ method: "upload", path: "Sources/files/notes.txt" })));
});
