import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { fakeClient, installMemoryLocalStorage, EMPTY_SNAPSHOT } from "../data/testing/fakeVault";
vi.mock("react-force-graph-2d", () => ({ default: () => null }));
beforeEach(() => {
  installMemoryLocalStorage();
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, layout: { sources: { style: "rich", subjectId: "__unsorted__" } } }));
  window.history.replaceState(null, "", "/?view=study-preview&settings=layout");
});
it("changes source box style only in Settings and persists it without losing the open subject", async () => {
  const first = render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  const select = within(dialog).getByLabelText("Box style");
  expect([...select.options].map((o) => o.textContent)).toEqual(["Rich box", "Simple box", "Preview box", "List"]);
  fireEvent.change(select, { target: { value: "preview" } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("study-preview-settings-v3")).layout.sources).toEqual({ style: "preview", subjectId: "__unsorted__" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  fireEvent.click(within(screen.getByRole("navigation", { name: "Sidebar" })).getByText("Sources"));
  expect(screen.queryByLabelText("Box style")).toBeNull();
  expect(document.querySelector(".st-src").dataset.boxStyle).toBe("preview");
  first.unmount();
  render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
  await waitFor(() => expect(document.querySelector(".st-src")?.dataset.boxStyle).toBe("preview"));
});
