import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { createHost } from "./host.js";
import { createServices } from "./services.js";
import { useExtensions } from "./ExtensionsProvider.jsx";
import { APP_VERSION } from "./installer.js";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { COLOR_ROLES } from "../theme/legacyPalettes.js";
import "./frame.css";

// The sandboxed iframe every extension UI runs in (widgets, blocks, tools,
// commands). No allow-same-origin: the frame has an opaque origin and only
// talks to the app through the host (host.js), over postMessage.
//
//   <ExtensionFrame record entry kind contributionId context
//                   hidden? maxHeight? onCommandReady? onBlockSave? />
//
//   kind             "widget" | "block" | "tool" | "command"
//   context          extra data for study.context (e.g. { pageId, blockData })
//   hidden           load without showing (commands); a failure toasts
//   maxHeight        cap for ui.resize (widgets and blocks)
//   onCommandReady   called once the frame has connected
//   onBlockSave      (data, text) => void, what block.save does (blocks)
//   ref.current.send(type, payload) posts { type: "study:<type>", payload }
//                    once connected; returns false before that
//
// Messages are accepted only from this iframe's window and with its random
// token. Each load or Reload starts a new session with a new host and token.
// Grants are read from the provider when each call arrives, not from the
// `record` prop, so a permission turned off, or the extension disabled or
// uninstalled, applies to frames that are already open.

export const CONNECT_TIMEOUT = 10_000;
const DEFAULT_HEIGHT = 120;
const MAX_FRAME_HEIGHT = 4000; // for blocks, which have no size cap of their own

// The tokens a frame needs to look like the app. A fixed list, so pointer
// tracking (--st-lx/--st-ly) and other internals never trigger updates.
const THEME_TOKENS = [...COLOR_ROLES.map((r) => r.css), "--st-accent", "--st-accent-ink", "--st-sans", "--st-mono", "--st-scale"];

export function readTheme(el) {
  const root = el?.closest?.(".study") ?? document.documentElement;
  const style = window.getComputedStyle(root);
  const read = (name) => String(style.getPropertyValue(name) ?? "").trim();
  const theme = Object.fromEntries(THEME_TOKENS.map((name) => [name, read(name)]));
  theme.accent = theme["--st-accent"];
  theme.fontFamily = read("font-family");
  theme.colorScheme = read("color-scheme") || "dark";
  return theme;
}

// Plain data only: JSON drops anything that isn't (functions, DOM nodes).
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

const frameContext = ({ context, kind, contributionId }) => ({
  ...plain(context ?? {}),
  kind,
  contributionId,
  appVersion: APP_VERSION,
});

const ExtensionFrame = forwardRef(function ExtensionFrame(
  { record, entry, kind, contributionId, context, hidden = false, maxHeight, onCommandReady, onBlockSave },
  ref
) {
  const study = useStudy();
  const shell = useShell();
  const { records, actions } = useExtensions();
  const iframeRef = useRef(null);
  const connection = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [failedSession, setFailedSession] = useState(null);
  const [size, setSize] = useState(null);

  const src = convertFileSrc(`${record.id}/${record.version}/${entry}`, "study-ext");
  const session = `${attempt}|${src}`;
  const failed = failedSession === session;
  const sized = kind === "widget" || kind === "block";
  const cap = Math.min(maxHeight ?? MAX_FRAME_HEIGHT, MAX_FRAME_HEIGHT);
  const name = record.manifest?.name ?? record.id;
  const stored = records && Object.prototype.hasOwnProperty.call(records, record.id) ? records[record.id] : null;

  // What the session reads when something happens, current on every render.
  const live = useRef(null);
  live.current = {
    state: study.state,
    actions: study.actions,
    shell,
    record,
    active: stored?.enabled ? stored : null,
    context,
    kind,
    contributionId,
    hidden,
    name,
    onCommandReady,
    blockSave: onBlockSave,
    reportFailure: actions.reportFailure,
    resize: (height) => {
      if (!sized) return null;
      const next = Math.min(Math.round(height), cap);
      setSize({ session, height: next });
      return next;
    },
  };

  // A layout effect, so the listeners are in place before the frame can load.
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    const host = createHost({
      record: () => live.current.active,
      context: frameContext(live.current),
      services: createServices(() => live.current),
    });
    let ready = false;
    let stopped = false;
    let sentTheme = "";

    const post = (message) => {
      if (!stopped) iframe.contentWindow?.postMessage(message, "*");
    };

    const sendTheme = (type) => {
      const theme = readTheme(iframe);
      const text = JSON.stringify(theme);
      if (type === "study:theme" && text === sentTheme) return;
      sentTheme = text;
      post(type === "study:init" ? { type, token: host.token, context: frameContext(live.current), theme } : { type, theme });
    };

    // Every load is a new document, which has to connect again in time.
    const onLoad = () => {
      ready = false;
      clearTimeout(timer);
      timer = setTimeout(fail, CONNECT_TIMEOUT);
      sendTheme("study:init");
    };

    const onMessage = (event) => {
      if (!event.source || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (typeof data.type !== "string") {
        host.handle(data).then((response) => response && post(response));
        return;
      }
      if (data.token !== host.token) return;
      if (data.type === "study:ready" && !ready) {
        ready = true;
        clearTimeout(timer);
        sendTheme("study:theme"); // in case it changed while connecting
        live.current.onCommandReady?.();
      } else if (data.type === "study:error") {
        fail();
      }
    };

    const observer = new MutationObserver(() => ready && sendTheme("study:theme"));

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      if (connection.current?.session === session) connection.current = null;
    }

    function fail() {
      if (stopped) return;
      stop();
      const { record: current, reportFailure, hidden: isHidden, shell: currentShell, name: currentName } = live.current;
      reportFailure(current.id);
      if (isHidden) currentShell?.toast?.(`${currentName} stopped responding`);
      setFailedSession(session);
    }

    let timer = setTimeout(fail, CONNECT_TIMEOUT);
    iframe.addEventListener("load", onLoad);
    window.addEventListener("message", onMessage);
    const root = iframe.closest(".study");
    if (root) observer.observe(root, { attributes: true });
    connection.current = { session, isReady: () => ready && !stopped, post };
    return stop;
  }, [session]);

  useImperativeHandle(
    ref,
    () => ({
      send(type, payload) {
        const open = connection.current;
        if (!open?.isReady()) return false;
        open.post({ type: `study:${type}`, payload: plain(payload) });
        return true;
      },
    }),
    []
  );

  if (failed) {
    if (hidden) return null;
    return (
      <div className="st-ext-frame-error" data-kind={kind} role="alert">
        <span>{name} stopped responding</span>
        <span className="st-faint" aria-hidden="true">
          ·
        </span>
        <button className="st-small-button" onClick={() => setAttempt((a) => a + 1)}>
          Reload
        </button>
      </div>
    );
  }

  const contribution = record.manifest?.contributes?.[`${kind}s`]?.find((c) => c.id === contributionId);
  const height = size?.session === session ? size.height : Math.min(DEFAULT_HEIGHT, cap);
  return (
    <iframe
      key={session}
      ref={iframeRef}
      className="st-ext-frame"
      data-kind={kind}
      data-hidden={hidden || undefined}
      sandbox="allow-scripts"
      src={src}
      title={contribution?.title ? `${contribution.title} · ${name}` : name}
      style={sized ? { height: `${height}px` } : undefined}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
    />
  );
});

export default ExtensionFrame;
