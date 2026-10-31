import { useCallback, useEffect, useMemo, useRef } from "react";
import { closeTab, openTab, reorderTabs, routeOf, sanitizeTabs, tabIdOf } from "./tabs";

// The open tabs, kept in Settings (layout.tabs) and cleaned whenever study
// data changes so deleted pages and sources lose their tabs.
// Returns the tabs, the active tab's route and the operations on them.
export function useTabs(saved, save, state) {
  const tabs = useMemo(() => sanitizeTabs(saved, state), [saved, state]);
  const latest = useRef(tabs);
  latest.current = tabs;
  const saveRef = useRef(save);
  saveRef.current = save;
  // The route last used to open each tab, so it keeps `via` and `fresh`.
  const routes = useRef(new Map());

  useEffect(() => {
    if (tabs !== saved) saveRef.current(tabs);
  }, [tabs, saved]);

  const commit = useCallback((next) => {
    latest.current = next;
    saveRef.current(next);
  }, []);

  const open = useCallback(
    (route) => {
      const id = tabIdOf(route);
      routes.current.set(id, route);
      commit(openTab(latest.current, id));
    },
    [commit]
  );

  const select = useCallback(
    (id) => {
      const route = routes.current.get(id);
      if (route?.fresh) routes.current.set(id, { ...route, fresh: undefined });
      commit(openTab(latest.current, id));
    },
    [commit]
  );

  const close = useCallback(
    (id) => {
      routes.current.delete(id);
      commit(closeTab(latest.current, id));
    },
    [commit]
  );

  const reorder = useCallback((id, to) => commit(reorderTabs(latest.current, id, to)), [commit]);

  const route = routes.current.get(tabs.active) ?? routeOf(tabs.active);
  return { tabs, route, open, select, close, reorder };
}
