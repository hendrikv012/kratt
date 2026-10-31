import { describe, it, expect, vi, afterEach } from "vitest";
import SOURCE from "./client/study-extension.js?raw";
import STYLES from "./client/study-extension.css?raw";

// Runs the client as a classic script inside a real (jsdom) iframe, the way
// an extension page loads it, with this document playing the app.
function loadClient() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const app = win.parent;
  const sent = vi.spyOn(app, "postMessage").mockImplementation(() => {});
  spies.push(sent);
  const script = win.document.createElement("script");
  script.textContent = SOURCE;
  win.document.body.appendChild(script);
  const deliver = (data, source = app) => win.dispatchEvent(new win.MessageEvent("message", { data, source }));
  const lastSent = () => sent.mock.calls.at(-1)?.[0];
  return { iframe, win, app, sent, deliver, lastSent };
}

const INIT = {
  type: "study:init",
  token: "t0k3n",
  context: { kind: "widget", contributionId: "clock", appVersion: "1.0.0" },
  theme: { "--st-bg": "#000000", "--st-accent": "#4c90f0", accent: "#4c90f0", fontFamily: "Archivo", colorScheme: "dark" },
};

async function connected() {
  const client = loadClient();
  const connecting = client.win.StudyExtension.connect();
  client.deliver(INIT);
  const study = await connecting;
  return { ...client, study };
}

// Only this file's spies are restored; the shared console spies stay.
const spies = [];
afterEach(() => {
  document.body.innerHTML = "";
  spies.splice(0).forEach((spy) => spy.mockRestore());
});

describe("study extension client", () => {
  it("defines StudyExtension without module syntax", () => {
    expect(SOURCE).not.toMatch(/^\s*(import|export)\s/m);
    expect(typeof loadClient().win.StudyExtension.connect).toBe("function");
  });

  it("connects on the app's hello, says ready, and applies the theme", async () => {
    const { study, lastSent, win } = await connected();
    expect(lastSent()).toEqual({ type: "study:ready", token: "t0k3n" });
    expect(study.context).toEqual(INIT.context);
    expect(study.theme.accent).toBe("#4c90f0");
    const root = win.document.documentElement;
    expect(root.style.getPropertyValue("--st-bg")).toBe("#000000");
    expect(root.style.getPropertyValue("--st-font")).toBe("Archivo");
  });

  it("works when connect() is called after the hello arrived", async () => {
    const { win, deliver, lastSent } = loadClient();
    deliver(INIT);
    const study = await win.StudyExtension.connect();
    expect(study.context.kind).toBe("widget");
    expect(lastSent()).toEqual({ type: "study:ready", token: "t0k3n" });
  });

  it("ignores a hello from anything but the app", async () => {
    const { win, deliver, sent } = loadClient();
    const other = document.createElement("iframe");
    document.body.appendChild(other);
    let done = false;
    win.StudyExtension.connect().then(() => (done = true));
    deliver({ ...INIT, token: "fake" }, other.contentWindow);
    deliver({ ...INIT, token: "fake" }, win);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(sent).not.toHaveBeenCalled();
  });

  it("sends calls with the token and resolves with the result", async () => {
    const { study, lastSent, deliver } = await connected();
    const pages = study.pages.read("p1");
    const call = lastSent();
    expect(call).toEqual({ token: "t0k3n", id: expect.any(Number), method: "pages.read", params: { id: "p1" } });
    deliver({ id: call.id, result: { id: "p1", name: "Krebs", html: "", text: "" } });
    await expect(pages).resolves.toMatchObject({ name: "Krebs" });
  });

  it("rejects with the error code and the missing permission", async () => {
    const { study, lastSent, deliver } = await connected();
    const write = study.mastery.set("p1", 0.5);
    deliver({ id: lastSent().id, error: { code: "permission", message: "Needs mastery.write", needs: "mastery.write" } });
    await expect(write).rejects.toMatchObject({ code: "permission", needs: "mastery.write" });
  });

  it("ignores answers from anything but the app", async () => {
    const { study, lastSent, deliver, win } = await connected();
    let settled = false;
    study.ui.toast("hi").then(() => (settled = true));
    deliver({ id: lastSent().id, result: "spoofed" }, win);
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it("maps every helper to its method and params", async () => {
    const { study, lastSent } = await connected();
    const calls = [
      [() => study.pages.list(), "pages.list", {}],
      [() => study.pages.write("p1", "<p>x</p>"), "pages.write", { id: "p1", html: "<p>x</p>" }],
      [() => study.subjects.list(), "subjects.list", {}],
      [() => study.mastery.get("p1"), "mastery.get", { id: "p1" }],
      [() => study.storage.get("k"), "storage.get", { key: "k" }],
      [() => study.storage.set("k", { a: 1 }), "storage.set", { key: "k", value: { a: 1 } }],
      [() => study.storage.remove("k"), "storage.remove", { key: "k" }],
      [() => study.fetch("https://a.com/", { method: "POST", body: "x" }), "fetch", { url: "https://a.com/", method: "POST", headers: undefined, body: "x" }],
      [() => study.ai.ask("q"), "ai.ask", { prompt: "q" }],
      [() => study.notify("Done", "Rest"), "notify", { title: "Done", body: "Rest" }],
      [() => study.ui.open({ view: "node", id: "p1" }), "ui.open", { view: "node", id: "p1" }],
      [() => study.ui.resize(80), "ui.resize", { height: 80 }],
      [() => study.block.save({ a: 1 }, "t"), "block.save", { data: { a: 1 }, text: "t" }],
    ];
    for (const [run, method, params] of calls) {
      run();
      expect(lastSent()).toMatchObject({ method, params });
    }
    study.ui.resize();
    expect(typeof lastSent().params.height).toBe("number");
  });

  it("passes theme changes and commands to listeners", async () => {
    const { study, deliver, win } = await connected();
    const onTheme = vi.fn();
    const onCommand = vi.fn();
    study.onTheme(onTheme);
    const stop = study.onCommand(onCommand);
    deliver({ type: "study:theme", theme: { "--st-bg": "#ffffff", colorScheme: "light" } });
    expect(onTheme).toHaveBeenCalledWith(expect.objectContaining({ "--st-bg": "#ffffff" }));
    expect(win.document.documentElement.style.getPropertyValue("--st-bg")).toBe("#ffffff");
    deliver({ type: "study:command", payload: { id: "count", pageId: "p1" } });
    expect(onCommand).toHaveBeenCalledWith({ id: "count", pageId: "p1" });
    stop();
    deliver({ type: "study:command", payload: { id: "count" } });
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("tells the app once when the page throws", async () => {
    const { win, lastSent, sent } = await connected();
    win.dispatchEvent(new win.ErrorEvent("error", { message: "boom" }));
    win.dispatchEvent(new win.ErrorEvent("error", { message: "again" }));
    expect(lastSent()).toEqual({ type: "study:error", token: "t0k3n" });
    expect(sent.mock.calls.filter(([m]) => m.type === "study:error")).toHaveLength(1);
  });

  it("loads the app's fonts from the files served next to the client", () => {
    const faces = STYLES.match(/@font-face\s*{[^}]*}/g) ?? [];
    expect(faces).toHaveLength(2);
    expect(faces[0]).toMatch(/font-family:\s*"Archivo Variable"/);
    expect(faces[0]).toContain('url("/_client/archivo.woff2") format("woff2-variations")');
    expect(faces[0]).toMatch(/font-weight:\s*100 900/);
    expect(faces[0]).toMatch(/font-stretch:\s*62% 125%/);
    expect(faces[1]).toMatch(/font-family:\s*"JetBrains Mono"/);
    expect(faces[1]).toContain('url("/_client/jetbrains-mono.woff2") format("woff2")');
    expect(faces[1]).toMatch(/font-weight:\s*400/);
  });
});
