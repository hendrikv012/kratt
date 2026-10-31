// The real services behind the host (see host.js for the shapes). The host
// has already checked permissions and parameter types; these check that ids
// exist and do the work through the study actions and the shell, never by
// writing state directly.
//
// `get()` returns the latest
//   { state, actions, shell, record, active, resize(height), blockSave?(data, text) }
// so a long-lived frame always sees current pages and settings. `record` is
// the one the frame was opened with (id, manifest); `active` is the
// provider's current record, or null when the extension is disabled or gone,
// and is what grants are read from.

import { invoke, isTauri } from "@tauri-apps/api/core";
import createDOMPurify from "dompurify";
import { HostError } from "./host.js";
import { parentIndex, subjectOf, UNSORTED } from "../data/tree";
import { getMarkdownCompiler } from "../../../core/markdown/compiler.js";

const DATA_KEY = "study-extension-data-v1:";

const notFound = (what) => new HostError("not-found", `No ${what} with that id`);

function pageOf(state, id) {
  const node = Object.prototype.hasOwnProperty.call(state.nodes, id) ? state.nodes[id] : null;
  if (node?.type !== "page") throw notFound("page");
  return node;
}

// ---------- What pages.write lets into a page ----------
// Page HTML is shown in the app's own window, so nothing an extension writes
// may run, load from the network or restyle the app. On top of DOMPurify's
// defaults:
//   - no style, frames, forms, SVG or MathML;
//   - src and srcset only as inline data:image/ URLs;
//   - no javascript: links, however they're spelled;
//   - highlight colours (data-color, which the editor copies into a style)
//     only as plain colours;
//   - the editor's two math nodes, SPAN[data-type=math-inline] and
//     DIV[data-type=math-block], keep their TeX in src and data-src unless it
//     holds a tag start or is very long.
// The editor also compiles stored content that looks like markdown
// (Editor.jsx), so pages.write checks what that compile would produce too.

const FORBID_TAGS = ["style", "script", "iframe", "object", "embed", "form", "meta", "link", "base", "svg", "math"];
const MATH_NODES = { SPAN: "math-inline", DIV: "math-block" };
const MATH_SOURCE_LIMIT = 2000;
const TAG_START = /<[A-Za-z!/?]/;
const PLAIN_COLOUR = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+|(?:rgba?|hsla?)\([\d.,%/\s]*\))$/i;
const MARKDOWN_PASSES = 3;
// FORCE_BODY parses like the editor does (inside <body>), so nothing slips
// into <head> unseen. `target` is kept because the editor writes it on links.
const CONFIG = { FORBID_TAGS, ADD_ATTR: ["target"], FORCE_BODY: true };

let purifier = null;
let hookRemoved = false; // set whenever the hook drops an attribute

const isMathNode = (node) => MATH_NODES[node.nodeName] !== undefined && node.getAttribute("data-type") === MATH_NODES[node.nodeName];

function pagePurifier() {
  if (purifier) return purifier;
  purifier = createDOMPurify(window); // its own instance, so the hook stays here
  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    const name = data.attrName;
    const value = String(data.attrValue ?? "");
    const drop = () => {
      data.keepAttr = false;
      hookRemoved = true;
    };
    if ((name === "src" || name === "data-src") && isMathNode(node)) {
      // TeX, not a URL: kept even where DOMPurify's URI check would drop it.
      if (TAG_START.test(value) || value.length > MATH_SOURCE_LIMIT) drop();
      else data.forceKeepAttr = true;
    } else if (name === "src" || name === "srcset") {
      if (!/^data:image\//i.test(value.trim())) drop();
    } else if (name === "href") {
      if (/^javascript:/i.test(value.replace(/[\s\u0000-\u001f]/g, ""))) drop();
    } else if (name === "data-color") {
      if (!PLAIN_COLOUR.test(value.trim())) drop();
    }
  });
  return purifier;
}

const sanitizePageHtml = (html) => pagePurifier().sanitize(html, CONFIG);

// Elements plus attributes, to tell whether a pass took anything out.
const shapeOf = (root) => [...root.querySelectorAll("*")].reduce((n, el) => n + 1 + el.attributes.length, 0);

// Sanitises and says whether anything was removed. The hook flag, DOMPurify's
// own list (minus FORCE_BODY's marker) and a before/after count are all
// checked: DOMPurify's list alone can lose an entry when it trims a value.
function sanitizeTracked(html) {
  const p = pagePurifier();
  const before = shapeOf(new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body);
  hookRemoved = false;
  const body = p.sanitize(html, { ...CONFIG, RETURN_DOM: true });
  const listed = p.removed.some((entry) => entry.element?.nodeName !== "REMOVE");
  return { html: body.innerHTML, removed: hookRemoved || listed || shapeOf(body) !== before };
}

// What pages.write stores: sanitised, and safe again after the editor's
// markdown compile. While the content looks like markdown, compile it the way
// the editor will; if sanitising that compile removes nothing, the stored
// content is safe as it is. Otherwise continue from the sanitised compile.
function safePageHtml(html) {
  const compiler = getMarkdownCompiler();
  let out = sanitizePageHtml(html);
  for (let pass = 0; pass < MARKDOWN_PASSES; pass++) {
    if (!compiler.isMarkdown(out)) return out;
    const compiled = sanitizeTracked(compiler.compile(out));
    if (!compiled.removed) return out;
    out = compiled.html;
  }
  if (!compiler.isMarkdown(out)) return out;
  throw new HostError("bad-params", "That content can't be saved safely");
}

// Page HTML as plain text, one line per block. DOMParser documents are
// inert, so nothing in the HTML runs or loads.
const BLOCK_END = /<\/(p|div|h[1-6]|li|blockquote|pre|tr)>|<br\s*\/?>/gi;
export function htmlToText(html = "") {
  const doc = new DOMParser().parseFromString(html.replace(BLOCK_END, "$&\n"), "text/html");
  return (doc.body.textContent ?? "")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// The system notification asks for permission once per app session.
let askedNotification = false;
export const resetNotificationAsk = () => {
  askedNotification = false;
};

function systemNotification(title, body) {
  const Notify = globalThis.Notification;
  if (!Notify) return;
  const show = () => {
    try {
      new Notify(title, { body });
    } catch {
      /* the webview has no system notifications */
    }
  };
  if (Notify.permission === "granted") return show();
  if (Notify.permission !== "default" || askedNotification) return;
  askedNotification = true;
  Promise.resolve(Notify.requestPermission?.())
    .then((answer) => answer === "granted" && show())
    .catch(() => {});
}

export function createServices(get) {
  const storageKey = () => DATA_KEY + get().record.id;

  return {
    pages: {
      // Mastery is a separate permission, so it's only listed with mastery.read.
      list: () => {
        const { state, active } = get();
        const parents = parentIndex(state);
        const withMastery = (active?.granted ?? []).includes("mastery.read");
        return Object.values(state.nodes)
          .filter((n) => n.type === "page")
          .map((n) => {
            const subject = subjectOf(state, parents, n.id);
            const page = { id: n.id, name: n.name, subjectId: subject && subject !== UNSORTED ? subject : null };
            if (withMastery) page.mastery = n.mastery ?? null;
            return page;
          });
      },
      read: (id) => {
        const page = pageOf(get().state, id);
        const html = page.content ?? "";
        return { id: page.id, name: page.name, html, text: htmlToText(html) };
      },
      write: (id, html) => {
        const { state, actions } = get();
        pageOf(state, id);
        actions.setContent(id, safePageHtml(html));
      },
    },
    subjects: {
      list: () => {
        const { state } = get();
        return state.subjects.map((id) => ({ id, name: state.nodes[id].name, color: state.nodes[id].color }));
      },
    },
    mastery: {
      get: (id) => pageOf(get().state, id).mastery ?? null,
      set: (id, value) => {
        const { state, actions } = get();
        pageOf(state, id);
        actions.setMastery(id, value);
      },
    },
    storage: {
      read: () => {
        try {
          const data = JSON.parse(localStorage.getItem(storageKey()));
          return data && typeof data === "object" && !Array.isArray(data) ? data : {};
        } catch {
          return {};
        }
      },
      write: (data) => localStorage.setItem(storageKey(), JSON.stringify(data)),
    },
    fetch: async (req) => {
      if (!isTauri()) throw new HostError("network", "Network access needs the desktop app");
      try {
        const { status, headers, body } = await invoke("ext_proxy_fetch", { req });
        return { status, headers, body };
      } catch (e) {
        throw new HostError("network", typeof e === "string" ? e : e?.message || "The request failed");
      }
    },
    // The shell's AI service (ai/onClient.js), asked on behalf of this extension.
    get ai() {
      const ai = get().shell?.ai;
      return ai ? { ask: (prompt) => ai.ask(get().record?.id, prompt) } : null;
    },
    notify: (title, body = "") => {
      get().shell.toast(title);
      systemNotification(title, body);
    },
    ui: {
      open: ({ view, id }) => {
        const { state, shell, record } = get();
        if (view === "node") {
          if (!Object.prototype.hasOwnProperty.call(state.nodes, id)) throw notFound("page, folder or subject");
          return shell.open({ view, id });
        }
        if (view === "tool") {
          const tools = record.manifest?.contributes?.tools ?? [];
          if (!tools.some((t) => t.id === id)) throw notFound("tool in this extension");
          return shell.open({ view, ext: record.id, tool: id });
        }
        return shell.open({ view });
      },
      toast: (text) => get().shell.toast(text),
      resize: (height) => get().resize(height),
    },
    block: {
      save: (data, text) => {
        const { blockSave } = get();
        if (!blockSave) throw new HostError("bad-params", "This frame can't save block data");
        blockSave(data, text);
      },
    },
  };
}
