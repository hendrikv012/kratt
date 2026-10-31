import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { vi } from "vitest";
import StudyPreview from "./StudyPreview";
import { HOME_ORDER } from "./home/grid";
import { EMPTY_SNAPSHOT, fakeClient } from "./data/testing/fakeVault";

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

// PDF.js can't run in the test DOM; stand in a reader that found two pages.
vi.mock("./sources/readPdf", async (importOriginal) => ({
  ...(await importOriginal()),
  pdfText: async () => ({ text: "Mitochondria make ATP.\n\nThe matrix holds the Krebs cycle.", pageCount: 2, readPages: 2, truncated: false }),
}));

beforeEach(() => {
  const store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
  window.history.replaceState(null, "", "/?view=study-preview");
});

const sidebar = () => screen.getByRole("navigation", { name: "Sidebar" });
// The app opens its Study folder first; give it an empty one and wait until it's open.
const renderStudy = async () => {
  const result = render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
  return result;
};
const title = () => screen.getByRole("textbox", { name: "Title" });
const renameTo = (name) => {
  fireEvent.change(title(), { target: { value: name } });
  fireEvent.blur(title());
};

describe("study app", () => {
  it("starts blank and builds subjects with folders inside folders", async () => {
    await renderStudy();
    expect(screen.getByText("Your subjects will appear here")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Add your first subject/ }));
    renameTo("Biology");
    expect(within(sidebar()).getByText("Biology")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /New folder/ }));
    fireEvent.change(within(sidebar()).getByRole("textbox", { name: "Name" }), { target: { value: "Cells" } });
    fireEvent.keyDown(within(sidebar()).getByRole("textbox", { name: "Name" }), { key: "Enter" });

    fireEvent.click(within(sidebar()).getByText("Cells"));
    fireEvent.click(screen.getByRole("button", { name: /New folder/ }));
    fireEvent.keyDown(within(sidebar()).getByRole("textbox", { name: "Name" }), { key: "Enter" });
    fireEvent.click(within(sidebar()).getByText("Untitled folder"));
    fireEvent.click(screen.getByRole("button", { name: /New page/ }));
    renameTo("Krebs cycle");

    // Breadcrumb shows the full path, and the editor is there.
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    ["Biology", "Cells", "Untitled folder", "Krebs cycle"].forEach((t) => expect(within(crumbs).getByText(t)).toBeTruthy());
    expect(screen.getByText("Not learned yet")).toBeTruthy();
    expect(document.querySelector(".st-editor")).toBeTruthy();

    // Back home, the graph draws what was just built.
    fireEvent.click(within(sidebar()).getByText("Home"));
    expect(within(screen.getByRole("list", { name: "Graph" })).getByText("Krebs cycle")).toBeTruthy();
    expect(screen.getByText("0 of 1 page learned")).toBeTruthy();
  });

  it("deleting a folder offers to keep its contents", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /Add your first subject/ }));
    renameTo("Math");
    fireEvent.click(screen.getByRole("button", { name: /New folder/ }));
    fireEvent.keyDown(within(sidebar()).getByRole("textbox", { name: "Name" }), { key: "Enter" });
    fireEvent.click(within(sidebar()).getByText("Untitled folder"));
    fireEvent.click(screen.getByRole("button", { name: /New page/ }));
    renameTo("Limits");

    fireEvent.click(within(sidebar()).getByRole("button", { name: "More for Untitled folder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete folder and everything inside")).toBeTruthy();
    fireEvent.click(within(dialog).getByText("Delete only the folder"));

    expect(within(sidebar()).queryByText("Untitled folder")).toBeNull();
    expect(within(sidebar()).getByText("Limits")).toBeTruthy();
  });

  it("quick notes save from the home widget and show in their own tab", async () => {
    await renderStudy();
    const widget = screen.getByRole("region", { name: "Notes" });
    fireEvent.change(within(widget).getByRole("textbox", { name: "New quick note" }), { target: { value: "Ask about mitosis" } });
    fireEvent.click(within(widget).getByRole("button", { name: "Save note" }));
    fireEvent.click(within(sidebar()).getByText("Notes"));
    expect(screen.getByDisplayValue("Ask about mitosis")).toBeTruthy();
  });

  it("deleting only a subject moves its contents to Unsorted", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /Add your first subject/ }));
    renameTo("Art");
    fireEvent.click(screen.getByRole("button", { name: /New page/ }));
    renameTo("Monet");
    fireEvent.click(within(sidebar()).getByRole("button", { name: "More for Art" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Delete only the subject"));

    expect(within(sidebar()).queryByText("Art")).toBeNull();
    expect(within(sidebar()).getByText("Unsorted")).toBeTruthy();
    expect(within(sidebar()).getByText("Monet")).toBeTruthy();
    fireEvent.click(within(sidebar()).getByText("Home"));
    expect(within(screen.getByRole("list", { name: "Graph" })).getByText("Monet")).toBeTruthy();
  });

  it("opening a subject adds a tab, and closing it returns to Home", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /Add your first subject/ }));
    renameTo("Biology");
    const tab = screen.getByRole("tab", { name: /Biology/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close Biology" }));
    expect(screen.queryByRole("tab", { name: /Biology/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Kratt Chat opens from the tab bar", async () => {
    await renderStudy();
    const panel = document.querySelector(".st-ai");
    expect(panel.dataset.open).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Kratt Chat" }));
    expect(panel.dataset.open).toBe("true");
    expect(panel.style.width).toBe("360px");
  });

  it("the Graph tab shows the whole graph with Lokus's Graph Settings, whose search filters it", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /Add your first subject/ }));
    renameTo("Biology");
    fireEvent.click(screen.getByRole("button", { name: /New folder/ }));
    fireEvent.keyDown(within(sidebar()).getByRole("textbox", { name: "Name" }), { key: "Enter" });

    fireEvent.click(within(sidebar()).getByText("Graph"));
    const graph = () => screen.getByRole("list", { name: "Graph" });
    const settings = screen.getByRole("complementary", { name: "Graph settings" });
    expect(within(settings).getByText("Graph Settings")).toBeTruthy();
    expect(within(settings).getByDisplayValue("How well you know it")).toBeTruthy();
    expect(within(graph()).getByText("Untitled folder")).toBeTruthy();

    fireEvent.change(within(settings).getByPlaceholderText("Filter nodes..."), { target: { value: "bio" } });
    expect(within(graph()).queryByText("Untitled folder")).toBeNull();
    expect(within(graph()).getByText("Biology")).toBeTruthy();
  });

  it("Sources: add pasted text, open it, untick it, and delete it", async () => {
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    expect(screen.getByText("No sources yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New source/ }));

    let dialog = screen.getByRole("dialog", { name: "Add source" });
    fireEvent.click(within(dialog).getByRole("tab", { name: /Enter text/ }));
    fireEvent.change(within(dialog).getByPlaceholderText("Paste or type your content here..."), {
      target: { value: "Mitosis\nCells divide into two." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));

    // The first line became the title.
    const row = screen.getByText("Mitosis").closest("tr");
    expect(within(row).getByText("Text")).toBeTruthy();
    fireEvent.click(within(row).getByRole("checkbox", { name: "Use Mitosis" }));
    expect(within(row).getByRole("checkbox", { name: "Use Mitosis" }).checked).toBe(false);

    fireEvent.click(row);
    expect(screen.getByDisplayValue("Mitosis")).toBeTruthy();
    expect(screen.getByText(/Cells divide into two/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Used").nextSibling.textContent).toBe("No");

    fireEvent.click(screen.getByRole("button", { name: "Delete source" }));
    dialog = screen.getByRole("dialog", { name: "Delete source" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(screen.getByText("No sources yet")).toBeTruthy();
  });

  it("Sources: several links at once, and a bad line is caught", async () => {
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    fireEvent.click(screen.getByRole("button", { name: /New source/ }));
    const dialog = screen.getByRole("dialog", { name: "Add source" });
    const urls = within(dialog).getByRole("textbox");
    fireEvent.change(urls, { target: { value: "https://www.khanacademy.org/biology\nnot a link" } });
    expect(within(dialog).getByText(/Not a web address: line 2/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Add source" }).disabled).toBe(true);

    fireEvent.change(urls, { target: { value: "https://www.khanacademy.org/biology\nhttps://en.wikipedia.org/wiki/Mitosis" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    expect(screen.getByText("khanacademy.org/biology")).toBeTruthy();
    expect(screen.getByText("en.wikipedia.org/wiki/Mitosis")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "All sources" })).toBeTruthy();
  });

  it("Sources: a text file keeps its text", async () => {
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    fireEvent.click(screen.getByRole("button", { name: /New source/ }));
    const dialog = screen.getByRole("dialog", { name: "Add source" });
    fireEvent.click(within(dialog).getByRole("tab", { name: /Upload file/ }));
    const file = new File(["Photosynthesis makes sugar."], "photo-notes.txt", { type: "text/plain" });
    fireEvent.change(dialog.querySelector('input[type="file"]'), { target: { files: [file] } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    });
    fireEvent.click(await screen.findByText("photo-notes"));
    expect(screen.getByText("Photosynthesis makes sugar.")).toBeTruthy();
  });

  it("Sources: a PDF keeps its text", async () => {
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    fireEvent.click(screen.getByRole("button", { name: /New source/ }));
    const dialog = screen.getByRole("dialog", { name: "Add source" });
    fireEvent.click(within(dialog).getByRole("tab", { name: /Upload file/ }));
    const file = new File(["%PDF-1.4"], "Chapter 9.pdf", { type: "application/pdf" });
    fireEvent.change(dialog.querySelector('input[type="file"]'), { target: { files: [file] } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    });
    fireEvent.click(await screen.findByText("Chapter 9"));
    expect(screen.getByText(/Mitochondria make ATP/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Pages").nextSibling.textContent).toBe("2");
  });

  it("quick notes show in the graph as loose dots", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /Add your first subject/ }));
    renameTo("Biology");
    fireEvent.click(within(sidebar()).getByText("Home"));
    const widget = screen.getByRole("region", { name: "Notes" });
    fireEvent.change(within(widget).getByRole("textbox", { name: "New quick note" }), { target: { value: "Ask about mitosis" } });
    fireEvent.click(within(widget).getByRole("button", { name: "Save note" }));
    expect(within(screen.getByRole("list", { name: "Graph" })).getByText("Ask about mitosis")).toBeTruthy();
  });

  it("empty widgets keep their place and say what will appear there", async () => {
    window.localStorage.setItem(
      "study-preview-settings-v3",
      JSON.stringify({ appearance: { upgraded: 2 }, layout: { kinds: { home: { lanes: { left: ["review", "recent", "notes"] } } } } })
    );
    await renderStudy();
    // The saved lanes became the grid in their order, with the lanes they
    // didn't save shown as before (clock on top; deadlines and chats on the right).
    expect([...document.querySelectorAll("[data-tile]")].map((t) => t.dataset.tile)).toEqual(["clock", "review", "recent", "notes", "deadlines", "chats"]);
    expect(within(screen.getByRole("region", { name: "Due for review" })).getByText(/All caught up/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Recent pages" })).getByText("Pages you open will appear here.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Notes" })).toBeTruthy();

    // No graph tile here, so the subject comes from the sidebar.
    fireEvent.click(within(sidebar()).getAllByRole("button", { name: "New subject" })[0]);
    fireEvent.keyDown(within(sidebar()).getByRole("textbox", { name: "Name" }), { key: "Enter" });
    fireEvent.click(within(sidebar()).getByText("Untitled subject"));
    fireEvent.click(screen.getByRole("button", { name: /New page/ }));
    fireEvent.click(within(sidebar()).getByText("Home"));
    expect(within(screen.getByRole("region", { name: "Recent pages" })).getByRole("list")).toBeTruthy();
  });
  it("a saved layout with a widget nobody registered shows Missing widget and the rest of Home", async () => {
    window.localStorage.setItem(
      "study-preview-settings-v3",
      JSON.stringify({ appearance: { upgraded: 2 }, layout: { kinds: { home: { lanes: { left: ["ext:gone/w", "review"] } } } } })
    );
    await renderStudy();
    const missing = screen.getByRole("region", { name: "Missing widget" });
    expect(within(missing).getByText(/isn't installed/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Due for review" })).toBeTruthy();

    // Settings removes it.
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(within(dialog).getByRole("navigation")).getByRole("button", { name: "Layout and home screen" }));
    fireEvent.click(within(dialog).getByRole("switch", { name: "Remove ext:gone/w on Home" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Missing widget" })).toBeNull();
    expect(screen.getByRole("region", { name: "Due for review" })).toBeTruthy();
  });

  it("Show near the edge puts the tab bar over the content instead of above it", async () => {
    await renderStudy();
    const bar = () => document.querySelector(".st-tabbar");
    expect(bar().dataset.auto).toBeUndefined();
    expect(bar().className).not.toContain("absolute");

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(within(dialog).getByRole("navigation")).getByRole("button", { name: "Layout and home screen" }));
    const choice = within(dialog).getByRole("radiogroup", { name: "Tab bar" });
    expect(within(choice).getByRole("radio", { name: "Always shown" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(choice).getByRole("radio", { name: "Show near the edge" }));
    expect(within(choice).getByRole("radio", { name: "Show near the edge" }).getAttribute("aria-checked")).toBe("true");

    expect(bar().dataset.auto).toBe("true");
    expect(bar().className).toContain("absolute");
    expect(bar().dataset.shown).toBe("false");
    // Pointing at the top edge brings it in without moving the content.
    const main = document.querySelector(".st-main");
    main.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 4 });
    expect(bar().dataset.shown).toBe("true");
  });

  it("the sidebar changes side from its hidden button and by dragging its header", async () => {
    await renderStudy();
    const root = () => document.querySelector(".study");
    expect(root().dataset.side).toBe("left");
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Move sidebar to the right" }));
    expect(root().dataset.side).toBe("right");
    expect(sidebar().dataset.side).toBe("right");

    const head = sidebar().querySelector(".st-side-head");
    const inner = window.innerWidth;
    window.innerWidth = 1000;
    try {
      fireEvent.mouseDown(head, { button: 0, clientX: 900 });
      fireEvent.mouseUp(window, { clientX: 100 });
      expect(root().dataset.side).toBe("left");

      // A plain click, or a move under 4px, doesn't flip it.
      fireEvent.mouseDown(head, { button: 0, clientX: 100 });
      fireEvent.mouseUp(window, { clientX: 100 });
      fireEvent.mouseDown(head, { button: 0, clientX: 100 });
      fireEvent.mouseUp(window, { clientX: 103 });
      expect(root().dataset.side).toBe("left");
    } finally {
      window.innerWidth = inner;
    }
  });

  it("opens the Extensions tab from the sidebar and from Settings", async () => {
    await act(async () => {
      render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Extensions" }));
    expect(screen.getByRole("heading", { name: "Extensions" })).toBeTruthy();
    expect(screen.getByText("No extensions installed. Installing extensions isn't available yet.")).toBeTruthy();
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Home" }));
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Extensions" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Extensions" })).toBeTruthy();
  });

  it("a drag that starts on a peeking sidebar survives the pointer leaving it", async () => {
    window.history.replaceState(null, "", "/?view=study-preview&sidebar=hidden");
    await act(async () => {
      render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
    });
    fireEvent.pointerEnter(document.querySelector(".st-edge"));
    const nav = sidebar();
    const inner = window.innerWidth;
    window.innerWidth = 1000;
    try {
      fireEvent.mouseDown(nav.querySelector(".st-side-head"), { button: 0, clientX: 50 });
      fireEvent.pointerLeave(nav);
      expect(sidebar()).toBeTruthy();
      fireEvent.mouseUp(window, { clientX: 900 });
      expect(document.querySelector(".study").dataset.side).toBe("right");
    } finally {
      window.innerWidth = inner;
    }
  });

  it("Home is a grid of tiles with no edit button", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    await renderStudy();
    const tiles = [...document.querySelectorAll("[data-tile]")].map((t) => t.dataset.tile);
    expect(tiles).toEqual(HOME_ORDER);
    expect(document.querySelector('[data-tile="graph"]').style.getPropertyValue("--w")).toBe("4");
    expect(document.querySelector('[data-tile="graph"]').style.getPropertyValue("--h")).toBe("2");
    expect(screen.queryByRole("button", { name: /edit home/i })).toBeNull();
  });

  it("right-click offers Edit home screen", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    await renderStudy();
    fireEvent.contextMenu(document.querySelector('[data-tile="clock"]'));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit home screen…" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("heading", { name: "Layout and home screen" })).toBeTruthy();
  });

  it("right-clicking the note box keeps the browser's own menu", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    await renderStudy();
    const widget = screen.getByRole("region", { name: "Notes" });
    const notPrevented = fireEvent.contextMenu(within(widget).getByRole("textbox", { name: "New quick note" }));
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Ctrl+E on Home opens Settings at the home screen", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    await renderStudy();
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("heading", { name: "Layout and home screen" })).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Edit layout" })).toBeNull();
  });

  it("Settings turns Home tiles on and off, and Reset to default can be undone", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    await renderStudy();
    const tiles = () => [...document.querySelectorAll("[data-tile]")].map((t) => t.dataset.tile);
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(within(dialog).getByRole("navigation")).getByRole("button", { name: "Layout and home screen" }));
    expect(within(dialog).queryByRole("switch", { name: /Legend on Home/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("switch", { name: "Add Recent pages on Home" }));
    fireEvent.click(within(dialog).getByRole("switch", { name: "Remove Continue studying on Home" }));
    expect(tiles()).toEqual(["graph", "clock", "review", "chats", "deadlines", "notes", "recent"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset to default" }));
    expect(tiles()).toEqual(HOME_ORDER);
    fireEvent.keyDown(dialog, { key: "Escape" });

    fireEvent.click(within(screen.getByText("Layout saved").closest(".st-toast")).getByRole("button", { name: "Undo" }));
    expect(tiles()).toEqual(["graph", "clock", "review", "chats", "deadlines", "notes", "recent"]);
  });

  it("Home empty states show Kratt", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    await renderStudy();
    const review = screen.getByRole("region", { name: "Due for review" });
    expect(within(review).getByText("All caught up. Kratt is keeping watch until something starts to fade.")).toBeTruthy();
    const hopping = review.querySelector(".st-kratt");
    expect(hopping.dataset.mode).toBe("hop");
    expect(hopping.getAttribute("width")).toBe("56");

    const chats = screen.getByRole("region", { name: "Latest chats" });
    expect(within(chats).getByText("No chats yet. Kratt is ready when you are.")).toBeTruthy();
    const sizes = [...chats.querySelectorAll(".st-kratt")].map((k) => k.getAttribute("width"));
    expect(sizes).toEqual(["16", "40"]);
  });

  it("open tabs and the active tab come back after the app is closed and opened", async () => {
    const first = await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    fireEvent.click(within(sidebar()).getByText("Notes"));
    first.unmount();
    await renderStudy();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Home", "Sources", "Notes"]);
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
  });
});
