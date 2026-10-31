import { useEffect, useRef, useState } from "react";

const EDGE = 10; // how close to the edge the pointer must come
const MARGIN = 12; // how far past the bar the pointer can stray
const HIDE_MS = 450;

/**
 * Whether an overlay bar is shown. When `enabled` is false the bar is always
 * shown. Otherwise it shows when the pointer comes within 10px of the
 * container's `edge` (or leaves the window through it) and while the bar has
 * focus or `keepOpen()` is true. It hides 450ms after the pointer leaves the
 * bar's box plus 12px.
 */
export function useAutoHide({ enabled, edge = "top", containerRef, barRef, keepOpen }) {
  const [shown, setShown] = useState(false);
  const keepRef = useRef(keepOpen);
  keepRef.current = keepOpen;

  useEffect(() => {
    if (!enabled) {
      setShown(false);
      return undefined;
    }
    let timer = null;
    let last = null; // where the pointer last was, so a resting pointer still counts
    const clear = () => {
      clearTimeout(timer);
      timer = null;
    };
    // Focus holds the bar only when it came from the keyboard, not from a click.
    const keyboardFocus = () => {
      const el = document.activeElement;
      if (!el || !barRef.current?.contains(el)) return false;
      try {
        return el.matches(":focus-visible");
      } catch {
        return true;
      }
    };
    const holding = () => Boolean(keepRef.current?.()) || keyboardFocus() || (last !== null && overBar(last.x, last.y));
    // Something may still be holding the bar open when the time is up; look again later.
    const scheduleHide = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (holding()) scheduleHide();
        else setShown(false);
      }, HIDE_MS);
    };
    const show = () => {
      clear();
      setShown(true);
    };

    const nearEdge = (x, y) => {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r || x < r.left || x > r.right) return false;
      return edge === "bottom" ? r.bottom - y <= EDGE : y - r.top <= EDGE;
    };
    const overBar = (x, y) => {
      const r = barRef.current?.getBoundingClientRect();
      return Boolean(r) && x >= r.left - MARGIN && x <= r.right + MARGIN && y >= r.top - MARGIN && y <= r.bottom + MARGIN;
    };

    const onMove = (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (nearEdge(e.clientX, e.clientY) || overBar(e.clientX, e.clientY)) show();
      else scheduleHide();
    };
    const onOut = (e) => {
      if (e.relatedTarget) return; // still inside the window
      last = null;
      if (nearEdge(e.clientX, e.clientY)) show();
      else scheduleHide();
    };
    const bar = barRef.current;
    const onFocusOut = (e) => {
      if (!bar.contains(e.relatedTarget)) scheduleHide();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseout", onOut);
    bar?.addEventListener("focusin", show);
    bar?.addEventListener("focusout", onFocusOut);
    return () => {
      clear();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
      bar?.removeEventListener("focusin", show);
      bar?.removeEventListener("focusout", onFocusOut);
    };
  }, [enabled, edge, containerRef, barRef]);

  return !enabled || shown;
}
