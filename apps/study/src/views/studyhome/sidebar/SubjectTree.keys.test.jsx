import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

vi.mock("../../../editor/components/Editor.jsx", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

beforeEach(() => {
  installMemoryLocalStorage();
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
});

const mount = async () => {
  render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
  return within(await screen.findByRole("navigation", { name: "Sidebar" }));
};
const rowOf = (side, name) => side.getByText(name).closest(".st-tree-row");
const key = (el, k) => fireEvent.keyDown(el, { key: k });
const focused = () => document.activeElement.querySelector?.(".st-tree-name")?.textContent;

describe("sidebar tree keyboard", () => {
  it("selects, focuses and opens a row on click", async () => {
    const side = await mount();
    fireEvent.click(rowOf(side, "Biology"));
    expect(rowOf(side, "Biology").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(rowOf(side, "Biology"));
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Biology")).toBeTruthy();
  });

  it("keeps selection when the chevron is clicked", async () => {
    const side = await mount();
    const chevron = rowOf(side, "Biology").querySelector("button");
    chevron.focus(); // jsdom does not focus on click
    fireEvent.click(chevron);
    expect(rowOf(side, "Biology").getAttribute("aria-selected")).toBe("true");
  });

  it("moves with arrows, expands and collapses, and jumps with Home/End", async () => {
    const side = await mount();
    const bio = rowOf(side, "Biology");
    bio.focus();
    key(bio, "ArrowRight");
    expect(within(document).queryByText("Cells")).toBeTruthy();
    key(bio, "ArrowRight");
    expect(focused()).toBe("Cells");
    key(document.activeElement, "ArrowLeft");
    expect(focused()).toBe("Biology");
    key(document.activeElement, "ArrowLeft");
    expect(screen.queryByText("Cells")).toBeNull();
    key(document.activeElement, "ArrowDown");
    const second = document.activeElement;
    expect(second).not.toBe(bio);
    key(second, "ArrowUp");
    expect(document.activeElement).toBe(bio);
    key(bio, "End");
    const rows = [...document.querySelectorAll('[role="treeitem"]')];
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    key(document.activeElement, "Home");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("opens with Enter and renames with F2", async () => {
    const side = await mount();
    const bio = rowOf(side, "Biology");
    bio.focus();
    key(bio, "Enter");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Biology")).toBeTruthy();
    key(bio, "F2");
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });

  it("has a single tab stop", async () => {
    await mount();
    expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });

  it("selects the next row when the selected one is deleted", async () => {
    const side = await mount();
    const names = () => [...document.querySelectorAll(".st-tree-row .st-tree-name")].map((n) => n.textContent);
    const bio = rowOf(side, "Biology");
    fireEvent.click(bio);
    fireEvent.click(within(bio).getByLabelText("More for Biology"));
    fireEvent.click(await screen.findByText("Delete…"));
    const confirm = within(await screen.findByRole("dialog")).getByRole("button", { name: /^delete only the subject/i });
    fireEvent.click(confirm);
    const after = names();
    expect(after).not.toContain("Biology");
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"]');
    expect(sel.querySelector(".st-tree-name").textContent).toBe(after[0]);
  });

  it("falls back to the collapsed ancestor and focuses it", async () => {
    const side = await mount();
    const bio = rowOf(side, "Biology");
    fireEvent.click(bio.querySelector('button[aria-label="Expand"]'));
    const kids = () => document.querySelector(`.st-tree-row[data-parent-id="${bio.dataset.treeId}"]`);
    const cells = kids();
    fireEvent.click(cells);
    expect(cells.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(rowOf(side, "Biology").querySelector('button[aria-label="Collapse"]'));
    expect(kids()).toBeNull();
    expect(rowOf(side, "Biology").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(rowOf(side, "Biology"));
  });

  const deleteBiology = async (side) => {
    const bio = rowOf(side, "Biology");
    fireEvent.click(within(bio).getByLabelText("More for Biology"));
    fireEvent.click(await screen.findByText("Delete…"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^delete only the subject/i }));
  };

  it("moves focus to the next row on delete when focus was in the tree", async () => {
    const side = await mount();
    fireEvent.click(rowOf(side, "Biology"));
    await deleteBiology(side);
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"]');
    expect(document.activeElement).toBe(sel);
  });

  it("leaves focus alone on delete when it was outside the tree", async () => {
    const side = await mount();
    fireEvent.click(rowOf(side, "Biology"));
    const input = document.createElement("input");
    document.body.appendChild(input);
    const dialogless = vi.spyOn(document, "activeElement", "get").mockReturnValue(input);
    await deleteBiology(side);
    dialogless.mockRestore();
    expect(document.activeElement).not.toBe(document.querySelector('[role="treeitem"][aria-selected="true"]'));
    input.remove();
  });

  it("links a nested group to its row with aria-owns", async () => {
    const side = await mount();
    fireEvent.click(rowOf(side, "Biology").querySelector('button[aria-label="Expand"]'));
    const owns = rowOf(side, "Biology").getAttribute("aria-owns");
    expect(owns).toBeTruthy();
    const group = document.getElementById(owns);
    expect(group.getAttribute("role")).toBe("group");
    expect(group.contains(rowOf(side, "Cells"))).toBe(true);
  });

  it("keeps the Unsorted header out of the tree roles", async () => {
    await mount();
    expect(document.querySelector(".st-unsorted-head").getAttribute("role")).toBe("none");
  });
});
