/* Study extension client. Load it in an extension page as a classic script:

     <link rel="stylesheet" href="/_client/study-extension.css">
     <script src="/_client/study-extension.js"></script>

   then:

     const study = await StudyExtension.connect();
     study.context                      { kind, contributionId, blockData?, appVersion, ... }
     study.theme                        the app's current tokens; study.onTheme(cb) for changes
     study.pages.list()                 pages.read    -> [{ id, name, subjectId, mastery }]
     study.pages.read(id)               pages.read    -> { id, name, html, text }
     study.pages.write(id, html)        pages.write
     study.subjects.list()              pages.read    -> [{ id, name, color }]
     study.mastery.get(id)              mastery.read  -> null or 0..1
     study.mastery.set(id, value)       mastery.write (null or 0..1)
     study.storage.get(key) / set(key, value) / remove(key)    your own data, 1 MB in all
     study.fetch(url, { method, headers, body })               network:<host> -> { status, headers, body }
     study.ai.ask(prompt)               ai
     study.notify(title, body)          notifications
     study.ui.open({ view, id })        view: home, graph, quick-notes, node (id), tool (your tool id)
     study.ui.toast(text)
     study.ui.resize(height?)           widgets and blocks; no height measures the page
     study.block.save(data, text)       blocks only; data is JSON, at most 64 KB
     study.onCommand(cb)                commands; cb gets { id, pageId }

   Every call returns a promise. A refused call rejects with an Error whose
   `code` is permission, unknown-method, bad-params, limit, ai-unavailable,
   network, not-found, or internal (a problem in the app, not your call);
   `needs` names a missing permission.

   An uncaught error in the page tells the app the extension has stopped
   responding, so catch the errors you expect. */
(() => {
  if (window.StudyExtension) return;

  const pending = new Map();
  const themeListeners = new Set();
  const commandListeners = new Set();
  let token = null;
  let init = null;
  let theme = {};
  let lastId = 0;
  let connecting = null;
  let finishConnect = null;
  let reportedError = false;

  const post = (message) => window.parent.postMessage(message, "*");

  function applyTheme(next) {
    theme = next && typeof next === "object" ? next : {};
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme)) {
      if (key.startsWith("--") && typeof value === "string" && value) root.style.setProperty(key, value);
    }
    if (theme.fontFamily) root.style.setProperty("--st-font", theme.fontFamily);
    if (theme.colorScheme) root.style.colorScheme = theme.colorScheme;
  }

  function call(method, params) {
    if (!token) return Promise.reject(new Error("Call StudyExtension.connect() first"));
    const id = ++lastId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ token, id, method, params });
    });
  }

  function settle(data) {
    const waiting = pending.get(data.id);
    if (!waiting) return;
    pending.delete(data.id);
    if (!data.error) return waiting.resolve(data.result);
    const error = new Error(data.error.message || data.error.code);
    error.code = data.error.code;
    if (data.error.needs) error.needs = data.error.needs;
    waiting.reject(error);
  }

  const listen = (set) => (cb) => {
    if (typeof cb !== "function") throw new TypeError("Pass a function");
    set.add(cb);
    return () => set.delete(cb);
  };

  const notifyAll = (set, value) =>
    set.forEach((cb) => {
      try {
        cb(value);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    });

  const measure = () => Math.ceil(document.body.scrollHeight);

  const study = {
    get context() {
      return init.context;
    },
    get theme() {
      return theme;
    },
    onTheme: listen(themeListeners),
    onCommand: listen(commandListeners),
    pages: {
      list: () => call("pages.list", {}),
      read: (id) => call("pages.read", { id }),
      write: (id, html) => call("pages.write", { id, html }),
    },
    subjects: { list: () => call("subjects.list", {}) },
    mastery: {
      get: (id) => call("mastery.get", { id }),
      set: (id, value) => call("mastery.set", { id, value }),
    },
    storage: {
      get: (key) => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value }),
      remove: (key) => call("storage.remove", { key }),
    },
    fetch: (url, options) => {
      const { method, headers, body } = options ?? {};
      return call("fetch", { url, method, headers, body });
    },
    ai: { ask: (prompt) => call("ai.ask", { prompt }) },
    notify: (title, body) => call("notify", { title, body }),
    ui: {
      open: (route) => call("ui.open", { view: route?.view, id: route?.id }),
      toast: (text) => call("ui.toast", { text }),
      resize: (height) => call("ui.resize", { height: height === undefined ? measure() : height }),
    },
    block: { save: (data, text) => call("block.save", { data, text }) },
  };

  function tryFinish() {
    if (!init || !finishConnect) return;
    const done = finishConnect;
    finishConnect = null;
    post({ type: "study:ready", token });
    done(study);
  }

  // Only the app (the parent window) may talk to this page; other frames
  // can reach it too, so their messages are dropped.
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "study:init") {
      if (init || typeof data.token !== "string") return;
      token = data.token;
      init = { context: Object.freeze({ ...data.context }) };
      applyTheme(data.theme);
      tryFinish();
    } else if (data.type === "study:theme") {
      if (!init) return;
      applyTheme(data.theme);
      notifyAll(themeListeners, theme);
    } else if (data.type === "study:command") {
      if (init) notifyAll(commandListeners, data.payload);
    } else if (data.type === undefined && data.id !== undefined) {
      settle(data);
    }
  });

  window.addEventListener("error", () => {
    if (!token || reportedError) return;
    reportedError = true;
    post({ type: "study:error", token });
  });

  window.StudyExtension = Object.freeze({
    // Waits for the app's hello, says ready, and resolves with the API.
    connect() {
      if (!connecting) {
        connecting = new Promise((resolve) => {
          finishConnect = resolve;
        });
        tryFinish();
      }
      return connecting;
    },
  });
})();
