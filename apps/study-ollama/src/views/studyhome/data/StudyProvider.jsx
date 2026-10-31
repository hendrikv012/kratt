import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_STATE, mutations } from "./operations";
import { parentIndex } from "./tree";
import { createVaultClient, VaultOffline } from "./vaultClient";
import { applyOps, movedPath, planSync, stateFromSnapshot } from "./vaultState";
import { createVaultSync } from "./vaultSync";

// Holds the study data for the whole app. The data lives as Markdown files in the Study
// folder; `memory-engine serve` reads and writes them. Every change is diffed into file
// operations (vaultState.planSync) and sent through a queue that never loses typing
// (vaultSync). Changes made on disk (by hand, or by the local AI) come back as events.

export const OFFLINE_MESSAGE = "Study folder not connected. Start it with: memory-engine serve";
const LEGACY_KEY = "study-app-data-v1";
const LEGACY_DONE_KEY = "study-app-data-v1-imported";
const REFRESH_DELAY = 300;
const START_RETRY = 2000;

const StudyContext = createContext(null);

// Pages, quick notes, sources or chats: something a folder switch or the first start must not lose.
const hasContent = (state) =>
  state.subjects.length > 0 || state.quickNotes.length > 0 || state.sources.length > 0 || state.chats.length > 0 ||
  Object.values(state.nodes).some((node) => node.type === "page");

function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const state = { ...EMPTY_STATE, ...saved, nodes: { ...EMPTY_STATE.nodes, ...saved.nodes } };
    return hasContent(state) ? { raw, state } : null;
  } catch {
    return null;
  }
}

const isEmptySnapshot = (snapshot) =>
  snapshot.files.length === 0 &&
  !snapshot.folders.some((path) => !["Unsorted", "Quick notes", "Sources", "Chats"].includes(path.split("/")[0]));

// `onPhase(phase)` hears every phase change; `renderGate(phase)` replaces the plain gate
// text while the folder isn't open (the app shows its opening screen instead).
export function StudyProvider({ children, client: givenClient, onPhase, renderGate }) {
  const client = useMemo(() => givenClient ?? createVaultClient(), [givenClient]);
  const [state, setState] = useState(EMPTY_STATE);
  const [phase, setPhase] = useState("loading"); // loading, offline (couldn't open), ready
  const [vault, setVault] = useState({ offline: false, unsavedSince: null, notice: null });

  // The latest state, so back-to-back actions build on each other and an action that
  // creates something can return its id straight away.
  const latest = useRef(state);
  const synced = useRef(EMPTY_STATE); // the state the folder holds (or will, once the queue runs)
  const paths = useRef({});
  const versions = useRef({}); // by id
  const sync = useRef(null);
  const refreshWanted = useRef(false);
  const refreshTimer = useRef(null);
  const waitingCopy = useRef(null); // a switch to an empty folder, waiting for "Copy my pages there"

  const adopt = (fresh) => {
    paths.current = fresh.paths;
    versions.current = Object.fromEntries(
      Object.entries(fresh.paths).map(([id, path]) => [id, fresh.versions[path]]).filter(([, v]) => v)
    );
    synced.current = fresh.state;
    latest.current = fresh.state;
    setState(fresh.state);
  };

  // Fill an empty Study folder with `state` (old browser data, or the pages of the folder
  // the app is leaving).
  const seed = (fresh, state) => {
    adopt(fresh);
    latest.current = state;
    setState(state);
    plan(state);
  };

  const relocate = (from, to) => {
    for (const [id, path] of Object.entries(paths.current)) paths.current[id] = movedPath(path, from, to);
  };

  // Paths are where things will be once the queue has run; a name the service chooses
  // instead (" (2)") corrects them.
  const plan = (next) => {
    if (waitingCopy.current) return; // the service points at a folder the app hasn't taken yet
    const planned = planSync(synced.current, next, paths.current, versions.current);
    synced.current = next;
    paths.current = planned.paths;
    if (planned.ops.length) sync.current.push(planned.ops);
  };

  // A change on disk: re-read the folder and take every file whose version differs from the
  // one we know. Files we wrote ourselves keep their in-app text, so the editor isn't reset.
  const refresh = async () => {
    if (sync.current?.pending().length) {
      refreshWanted.current = true;
      return;
    }
    refreshWanted.current = false;
    let snapshot;
    try {
      snapshot = await client.snapshot();
    } catch {
      return;
    }
    const fresh = stateFromSnapshot(snapshot);
    const freshVersions = Object.fromEntries(
      Object.entries(fresh.paths).map(([id, path]) => [id, fresh.versions[path]]).filter(([, v]) => v)
    );
    const ids = new Set([...Object.keys(freshVersions), ...Object.keys(versions.current)]);
    const changed = [...ids].some((id) => freshVersions[id] !== versions.current[id]);
    if (!changed) return;
    const current = latest.current;
    const nodes = { ...fresh.state.nodes };
    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === "page" && current.nodes[id] && freshVersions[id] === versions.current[id]) {
        nodes[id] = { ...node, content: current.nodes[id].content };
      }
    }
    adopt({ ...fresh, state: { ...fresh.state, nodes } });
  };

  useEffect(() => {
    let alive = true;
    let retry = null;
    sync.current = createVaultSync({
      client,
      onStatus: (status) => {
        if (!alive) return;
        setVault(status);
        if (!status.unsavedSince && refreshWanted.current) refresh();
      },
      onResult: (op, answer, moved) => {
        if (moved) relocate(moved.from, moved.to);
        if (op.op === "write" && op.id && answer.version) versions.current[op.id] = answer.version;
      },
    });

    const open = async () => {
      try {
        const snapshot = await client.snapshot();
        if (!alive) return;
        // Saves kept from an earlier session (the service was away, then the app closed) are
        // shown as they will be, and run straight away.
        const kept = sync.current.pending();
        const fresh = stateFromSnapshot(applyOps(snapshot, kept));
        const legacy = isEmptySnapshot(snapshot) ? readLegacy() : null;
        if (legacy) {
          // First start: write what browser storage held into the Study folder, once.
          seed(fresh, legacy.state);
          localStorage.setItem(LEGACY_DONE_KEY, legacy.raw);
          localStorage.removeItem(LEGACY_KEY);
        } else {
          adopt(fresh);
          if (kept.length) sync.current.flush();
        }
        setPhase("ready");
      } catch (error) {
        if (!alive) return;
        if (!(error instanceof VaultOffline)) console.error(error);
        setPhase("offline");
        retry = setTimeout(open, START_RETRY);
      }
    };
    open();
    const unsubscribe = client.subscribe(() => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refresh, REFRESH_DELAY);
    });
    return () => {
      alive = false;
      clearTimeout(retry);
      clearTimeout(refreshTimer.current);
      unsubscribe();
      sync.current?.stop();
    };
    // `client` is the only input; the helpers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    onPhase?.(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Every state change becomes file operations once the folder is open.
  useEffect(() => {
    if (phase === "ready" && state === latest.current && state !== synced.current) plan(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, phase]);

  const actions = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(mutations).map(([name, op]) => [
          name,
          (...args) => {
            const result = op(latest.current, ...args);
            const created = result.id !== undefined && result.state ? result : null;
            latest.current = created ? created.state : result;
            setState(latest.current);
            return created?.id;
          },
        ])
      ),
    []
  );

  // Settings → Study folder. Switching to an empty folder while the app has pages offers to
  // copy them over instead of showing an empty app straight away. Until the person answers,
  // changes wait; leaving the question unanswered goes back to the folder before.
  const switchFolder = async (path) => {
    if (sync.current?.pending().length) throw new Error("Still saving your last changes; try again in a moment");
    const before = await client.folder();
    const answer = await client.setFolder(path);
    const snapshot = await client.snapshot();
    const fresh = stateFromSnapshot(snapshot);
    if (isEmptySnapshot(snapshot) && hasContent(latest.current)) {
      waitingCopy.current = { fresh, previous: before.path };
      return { path: answer.path, empty: true };
    }
    waitingCopy.current = null;
    adopt(fresh);
    return { path: answer.path, empty: false };
  };
  const copyPagesHere = () => {
    const waiting = waitingCopy.current;
    if (!waiting) return;
    waitingCopy.current = null;
    seed(waiting.fresh, latest.current);
  };
  const startEmpty = () => {
    const waiting = waitingCopy.current;
    waitingCopy.current = null;
    if (waiting) adopt(waiting.fresh);
  };
  const cancelSwitch = async () => {
    const waiting = waitingCopy.current;
    if (!waiting) return;
    await client.setFolder(waiting.previous);
    waitingCopy.current = null;
    plan(latest.current);
  };

  const value = useMemo(
    () => ({
      state,
      parents: parentIndex(state),
      actions,
      client,
      vault: { ...vault, phase, dismissNotice: () => sync.current?.clearNotice(), switchFolder, copyPagesHere, startEmpty, cancelSwitch },
    }),
    [state, actions, client, vault, phase]
  );

  if (phase !== "ready") {
    if (renderGate) return renderGate(phase);
    return (
      <div className="st-vault-gate" role={phase === "offline" ? "alert" : "status"}>
        {phase === "offline" ? OFFLINE_MESSAGE : "Opening your Study folder…"}
      </div>
    );
  }
  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

// { state, parents, actions, client, vault }: the data, who contains what, every change,
// the Study folder service, and how saving is going.
export const useStudy = () => useContext(StudyContext);
