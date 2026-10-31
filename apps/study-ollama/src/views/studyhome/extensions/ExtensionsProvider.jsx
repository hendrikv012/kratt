import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadCatalog } from "./catalog.js";
import { canInstall, commitStaged, removeFiles } from "./installer.js";
import * as rec from "./records.js";

const RECORDS_KEY = "study-extensions-v1";
const DATA_KEY = "study-extension-data-v1:";
const DAY = 24 * 60 * 60 * 1000;
const KINDS = ["widgets", "blocks", "tools", "themes", "commands"];

const ExtensionsContext = createContext(null);

function loadRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECORDS_KEY));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

// Contributions from enabled records only, each tagged with its extension.
export function contributionsOf(enabled) {
  const out = Object.fromEntries(KINDS.map((k) => [k, []]));
  for (const r of enabled) {
    for (const kind of KINDS) {
      for (const item of r.manifest?.contributes?.[kind] ?? []) {
        out[kind].push({ extId: r.id, extName: r.manifest.name, version: r.version, ...item });
      }
    }
  }
  return out;
}

// `catalogUrl` comes from Settings > extensions; the study app reads settings
// once (in StudyPreview) and passes the URL down, so no second settings hook
// exists to overwrite the saved settings.
export function ExtensionsProvider({ catalogUrl = "", children }) {
  const [records, setRecords] = useState(loadRecords);
  const [catalog, setCatalog] = useState({ entries: [], offline: false, loading: false });
  const urlRef = useRef(catalogUrl);
  urlRef.current = catalogUrl;

  useEffect(() => {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
    } catch {
      /* storage unavailable */
    }
  }, [records]);

  const refresh = useCallback(async () => {
    const url = urlRef.current;
    setCatalog((c) => ({ ...c, loading: true }));
    const result = await loadCatalog(url);
    if (url !== urlRef.current) return; // the setting changed meanwhile
    setCatalog({ entries: result.entries, offline: result.offline, loading: false });
  }, []);

  // Once at start, when the URL changes, and daily after that.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, DAY);
    return () => clearInterval(timer);
  }, [catalogUrl, refresh]);

  const actions = useMemo(
    () => ({
      // `staged` comes from the installer (it carries the parsed manifest).
      install: async (staged, { source, granted }) => {
        await commitStaged(staged);
        setRecords((r) => rec.install(r, { manifest: staged.manifest, source, granted }));
      },
      uninstall: async (id) => {
        await removeFiles(id);
        try {
          localStorage.removeItem(DATA_KEY + id);
        } catch {
          /* storage unavailable */
        }
        setRecords((r) => rec.remove(r, id));
      },
      setEnabled: (id, on) => setRecords((r) => rec.setEnabled(r, id, on)),
      setGranted: (id, perm, on) => setRecords((r) => rec.setGranted(r, id, perm, on)),
      setToolHidden: (id, toolId, hidden) => setRecords((r) => rec.setToolHidden(r, id, toolId, hidden)),
      setPendingUpdate: (id, pending) => setRecords((r) => rec.setPendingUpdate(r, id, pending)),
      reportFailure: (id) => setRecords((r) => rec.recordFailure(r, id, Date.now())),
    }),
    []
  );

  // Memoised on records alone, so a catalog refresh doesn't hand consumers
  // new arrays (which would re-run their effects or remount frames).
  const enabled = useMemo(() => Object.values(records).filter((r) => r.enabled), [records]);
  const contributions = useMemo(() => contributionsOf(enabled), [enabled]);

  const value = useMemo(
    () => ({
      records,
      enabled,
      contributions,
      catalog: { ...catalog, url: catalogUrl, refresh },
      canInstall: canInstall(),
      actions,
    }),
    [records, enabled, contributions, catalog, catalogUrl, refresh, actions]
  );

  return <ExtensionsContext.Provider value={value}>{children}</ExtensionsContext.Provider>;
}

export function useExtensions() {
  const value = useContext(ExtensionsContext);
  if (!value) throw new Error("useExtensions must be used inside ExtensionsProvider");
  return value;
}
