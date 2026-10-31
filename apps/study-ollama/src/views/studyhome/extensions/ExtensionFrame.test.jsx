import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { ShellContext } from "../ShellContext";

const mocks = vi.hoisted(() => ({
  reportFailure: () => {},
  study: null,
  extensions: null, // the provider's latest value, for flipping grants
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path, protocol) => `${protocol}://localhost/${path}`,
  invoke: () => Promise.resolve(),
  isTauri: () => false,
}));
// The real provider; failures are also recorded for the tests to check.
vi.mock("./ExtensionsProvider.jsx", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    useExtensions: () => {
      const value = real.useExtensions();
      mocks.extensions = value;
      const reportFailure = (id) => {
        mocks.reportFailure(id);
        value.actions.reportFailure(id);
      };
      return { ...value, actions: { ...value.actions, reportFailure } };
    },
  };
});
vi.mock("../data/StudyProvider", () => ({ useStudy: () => mocks.study }));

import ExtensionFrame, { CONNECT_TIMEOUT } from "./ExtensionFrame.jsx";
import { ExtensionsProvider } from "./ExtensionsProvider.jsx";
import CLIENT from "./client/study-extension.js?raw";

const record = {
  id: "acme.timer",
  version: "1.2.0",
  source: "catalog",
  granted: [],
  enabled: true,
  hiddenTools: [],
  pendingUpdate: null,
  previousVersion: null,
  failures: [],
  manifest: { name: "Timer", contributes: { widgets: [{ id: "clock", title: "Clock", entry: "widget.html" }] } },
};

// Installed records the provider starts with.
function seed(records) {
  const store = new Map([["study-extensions-v1", JSON.stringify(records)]]);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

let shell;
beforeEach(() => {
  seed({ [record.id]: record });
  mocks.reportFailure = vi.fn();
  mocks.study = { state: { nodes: {}, subjects: [] }, actions: { setContent: vi.fn(), setMastery: vi.fn() } };
  shell = { open: vi.fn(), toast: vi.fn() };
});
afterEach(() => vi.useRealTimers());

function renderFrame(props = {}) {
  const ref = createRef();
  const utils = render(
    <ExtensionsProvider catalogUrl="">
      <ShellContext.Provider value={shell}>
        <div className="study">
          <ExtensionFrame
            ref={ref}
            record={record}
            entry="widget.html"
            kind="widget"
            contributionId="clock"
            context={{ pageId: "p1" }}
            {...props}
          />
        </div>
      </ShellContext.Provider>
    </ExtensionsProvider>
  );
  const frame = () => utils.container.querySelector("iframe");
  return { ...utils, ref, frame };
}

// Loads the frame and returns what it was sent, with a spy for later posts.
function load(iframe) {
  const post = vi.spyOn(iframe.contentWindow, "postMessage");
  fireEvent.load(iframe);
  const init = post.mock.calls.map(([m]) => m).find((m) => m.type === "study:init");
  return { post, init };
}

const fromWindow = (source, data) =>
  act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
    await Promise.resolve();
  });

describe("ExtensionFrame", () => {
  it("renders a sandboxed frame for the entry", () => {
    const { frame } = renderFrame();
    expect(frame().getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame().getAttribute("src")).toBe("study-ext://localhost/acme.timer/1.2.0/widget.html");
    expect(frame().getAttribute("title")).toBe("Clock · Timer");
  });

  it("sends a token, the context and the theme on load", () => {
    const { frame } = renderFrame();
    const { post, init } = load(frame());
    expect(init.token).toMatch(/^[0-9a-f]{32}$/);
    expect(init.context).toEqual({ pageId: "p1", kind: "widget", contributionId: "clock", appVersion: expect.any(String) });
    expect(init.theme).toHaveProperty("accent");
    expect(init.theme).toHaveProperty("fontFamily");
    expect(post).toHaveBeenCalledWith(init, "*");
  });

  it("shows stopped responding after 10 s without a ready message, and reports it", () => {
    vi.useFakeTimers();
    const { frame } = renderFrame();
    load(frame());
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT - 1));
    expect(screen.queryByText(/stopped responding/)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Timer stopped responding")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
    expect(mocks.reportFailure).toHaveBeenCalledWith("acme.timer");
    expect(frame()).toBeNull();
  });

  it("stays up once the frame says it's ready", async () => {
    vi.useFakeTimers();
    const { frame } = renderFrame();
    const { init } = load(frame());
    await fromWindow(frame().contentWindow, { type: "study:ready", token: init.token });
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT * 2));
    expect(screen.queryByText(/stopped responding/)).toBeNull();
    expect(mocks.reportFailure).not.toHaveBeenCalled();
  });

  it("expects a new page in the frame to connect again", async () => {
    vi.useFakeTimers();
    const { frame } = renderFrame();
    const { init } = load(frame());
    await fromWindow(frame().contentWindow, { type: "study:ready", token: init.token });
    fireEvent.load(frame()); // the extension navigated to another of its pages
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT));
    expect(screen.getByText("Timer stopped responding")).toBeTruthy();
  });

  it("ignores messages from a different source", async () => {
    vi.useFakeTimers();
    const { frame } = renderFrame();
    const { post, init } = load(frame());
    const other = document.createElement("iframe");
    document.body.appendChild(other);
    await fromWindow(other.contentWindow, { type: "study:ready", token: init.token });
    await fromWindow(window, { type: "study:ready", token: init.token });
    await fromWindow(null, { type: "study:ready", token: init.token });
    await fromWindow(other.contentWindow, { token: init.token, id: 1, method: "ui.toast", params: { text: "spoof" } });
    expect(shell.toast).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1); // only the init
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT));
    expect(screen.getByText("Timer stopped responding")).toBeTruthy();
    other.remove();
  });

  it("ignores a ready message with the wrong token", async () => {
    vi.useFakeTimers();
    const { frame } = renderFrame();
    load(frame());
    await fromWindow(frame().contentWindow, { type: "study:ready", token: "guess" });
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT));
    expect(screen.getByText("Timer stopped responding")).toBeTruthy();
  });

  it("answers calls from the frame, to the frame only", async () => {
    const { frame } = renderFrame();
    const { post, init } = load(frame());
    await fromWindow(frame().contentWindow, { token: init.token, id: 7, method: "ui.toast", params: { text: "hi" } });
    await act(async () => {});
    expect(shell.toast).toHaveBeenCalledWith("hi");
    expect(post).toHaveBeenLastCalledWith({ id: 7, result: null }, "*");
  });

  it("shows stopped responding when the frame reports an error", async () => {
    const { frame } = renderFrame();
    const { init } = load(frame());
    await fromWindow(frame().contentWindow, { type: "study:ready", token: init.token });
    await fromWindow(frame().contentWindow, { type: "study:error", token: init.token, message: "boom" });
    expect(screen.getByText("Timer stopped responding")).toBeTruthy();
    expect(mocks.reportFailure).toHaveBeenCalledWith("acme.timer");
  });

  it("reloads with a fresh token", () => {
    vi.useFakeTimers();
    const { frame } = renderFrame();
    const first = load(frame()).init;
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.queryByText(/stopped responding/)).toBeNull();
    const second = load(frame()).init;
    expect(second.token).not.toBe(first.token);
  });

  it("sends commands only once the frame is ready", async () => {
    const onCommandReady = vi.fn();
    const { frame, ref } = renderFrame({ kind: "command", hidden: true, onCommandReady });
    const { post, init } = load(frame());
    expect(ref.current.send("command", { id: "count", pageId: "p1" })).toBe(false);
    await fromWindow(frame().contentWindow, { type: "study:ready", token: init.token });
    expect(onCommandReady).toHaveBeenCalledTimes(1);
    expect(ref.current.send("command", { id: "count", pageId: "p1" })).toBe(true);
    expect(post).toHaveBeenLastCalledWith({ type: "study:command", payload: { id: "count", pageId: "p1" } }, "*");
  });

  it("toasts instead when a hidden frame stops responding", () => {
    vi.useFakeTimers();
    const { frame } = renderFrame({ kind: "command", hidden: true });
    load(frame());
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT));
    expect(shell.toast).toHaveBeenCalledWith("Timer stopped responding");
    expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  });

  it("sizes to ui.resize, capped by maxHeight", async () => {
    const { frame } = renderFrame({ maxHeight: 160 });
    const { post, init } = load(frame());
    await fromWindow(frame().contentWindow, { token: init.token, id: 1, method: "ui.resize", params: { height: 120 } });
    await act(async () => {});
    expect(frame().style.height).toBe("120px");
    await fromWindow(frame().contentWindow, { token: init.token, id: 2, method: "ui.resize", params: { height: 900 } });
    await act(async () => {});
    expect(frame().style.height).toBe("160px");
    expect(post).toHaveBeenLastCalledWith({ id: 2, result: 160 }, "*");
  });

  it("posts the theme again when the app's tokens change", async () => {
    const vars = { "--st-bg": "#000000", "--st-accent": "#4c90f0", "font-family": "Archivo" };
    const styles = vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ getPropertyValue: (name) => vars[name] ?? "" }));
    onTestFinished(() => styles.mockRestore());
    const { frame, container } = renderFrame();
    const { post, init } = load(frame());
    expect(init.theme).toMatchObject({ "--st-bg": "#000000", accent: "#4c90f0", fontFamily: "Archivo" });
    await fromWindow(frame().contentWindow, { type: "study:ready", token: init.token });
    vars["--st-bg"] = "#ffffff";
    await act(async () => {
      container.querySelector(".study").setAttribute("data-theme", "light");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(post).toHaveBeenLastCalledWith({ type: "study:theme", theme: expect.objectContaining({ "--st-bg": "#ffffff" }) }, "*");
    const sent = post.mock.calls.length;
    await act(async () => {
      container.querySelector(".study").setAttribute("data-glass", "solid"); // nothing visible changed
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(post).toHaveBeenCalledTimes(sent);
  });

  it("checks grants with the provider at call time, not the record it was given", async () => {
    const stale = { ...record, granted: ["pages.read"] };
    seed({ [record.id]: stale });
    const { frame } = renderFrame({ record: stale });
    const { post, init } = load(frame());
    const ask = async (id, method, params = {}) => {
      await fromWindow(frame().contentWindow, { token: init.token, id, method, params });
      await act(async () => {});
      return post.mock.calls.at(-1)[0];
    };
    expect(await ask(1, "pages.list")).toEqual({ id: 1, result: [] });

    act(() => mocks.extensions.actions.setGranted(record.id, "pages.read", false));
    expect((await ask(2, "pages.list")).error).toMatchObject({ code: "permission", needs: "pages.read" });

    act(() => {
      mocks.extensions.actions.setGranted(record.id, "pages.read", true);
      mocks.extensions.actions.setEnabled(record.id, false);
    });
    expect((await ask(3, "pages.list")).error.code).toBe("permission");
    expect(await ask(4, "ui.toast", { text: "still here" })).toEqual({ id: 4, result: null });
    expect(shell.toast).toHaveBeenCalledWith("still here");

    await act(async () => {
      mocks.extensions.actions.setEnabled(record.id, true);
      await mocks.extensions.actions.uninstall(record.id);
    });
    expect((await ask(5, "pages.list")).error.code).toBe("permission");
  });

  // Stands in for the brief's manual check: a hand-made test.hello page runs
  // the real client inside the frame and calls study.ui.toast("hi"). jsdom's
  // postMessage doesn't set event.source, so a small wire delivers messages
  // the way a browser does: cloned, later, with the sender as source.
  it("lets a hand-made extension toast through the real client", async () => {
    const hello = { ...record, id: "test.hello", version: "0.1.0", manifest: { name: "Hello", contributes: {} } };
    const { frame } = renderFrame({ record: hello, kind: "tool", contributionId: "main" });
    const win = frame().contentWindow;
    const deliver = (target, source, data) =>
      setTimeout(() => target.dispatchEvent(new target.MessageEvent("message", { data: structuredClone(data), source })), 0);
    const toApp = vi.spyOn(win.parent, "postMessage").mockImplementation((data) => deliver(window, win, data));
    onTestFinished(() => toApp.mockRestore());
    vi.spyOn(win, "postMessage").mockImplementation((data) => deliver(win, win.parent, data));
    const doc = win.document;
    const parent = doc.body ?? doc.documentElement ?? doc.appendChild(doc.createElement("html"));
    for (const code of [CLIENT, 'StudyExtension.connect().then((study) => study.ui.toast("hi")).then(() => { window.__done = true; });']) {
      const script = doc.createElement("script");
      script.textContent = code;
      parent.appendChild(script);
    }
    fireEvent.load(frame());
    await vi.waitFor(() => expect(win.__done).toBe(true));
    expect(shell.toast).toHaveBeenCalledWith("hi");
    expect(screen.queryByText(/stopped responding/)).toBeNull();
  });
});
