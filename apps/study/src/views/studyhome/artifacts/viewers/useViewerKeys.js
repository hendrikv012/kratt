import { useEffect, useRef } from "react";

const handled = new WeakSet();

// Keyboard for a viewer: `keyMap` maps `e.key` ("ArrowLeft", " ", "f") to a
// callback. Listens on the viewer and on window while the viewer is shown, and
// skips text fields, menus, handled events and Ctrl/Meta/Alt combos.
export default function useViewerKeys(ref, keyMap) {
  const map = useRef(keyMap);
  map.current = keyMap;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onKey = (e) => {
      if (handled.has(e)) return; // already run by the viewer listener
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!el.isConnected || el.closest("[hidden]")) return;
      const t = e.target;
      if (t?.closest?.("input, textarea, [contenteditable]:not([contenteditable='false']), [role='menu']")) return;
      // Buttons and links activate themselves on Space/Enter.
      if ((e.key === " " || e.key === "Enter") && t?.closest?.("button, a")) return;
      const fn = map.current[e.key] || (e.key.length === 1 ? map.current[e.key.toLowerCase()] : undefined);
      if (!fn) return;
      handled.add(e);
      e.preventDefault();
      fn();
    };
    el.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}
