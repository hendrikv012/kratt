import { useEffect, useRef, useState } from "react";

const REVEAL = 56; // the bar's height (44px) plus a margin, from the edge

const typingPlace = (el) => Boolean(el?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));

/**
 * Whether the tab bar is tucked away while you work ("Hide while working").
 * Typing in the page or scrolling it tucks the bar; bringing the pointer
 * within 56px of the container's `edge`, or focusing the bar, brings it back.
 * Shortcuts (Ctrl, Cmd or Alt held) aren't typing. Nothing tucks while
 * `keepOpen()` is true. When `enabled` is false the bar is never tucked.
 */
export function useWorkHide({ enabled, edge = "top", containerRef, barRef, keepOpen }) {
  const [tucked, setTucked] = useState(false);
  const keepRef = useRef(keepOpen);
  keepRef.current = keepOpen;

  useEffect(() => {
    if (!enabled) {
      setTucked(false);
      return undefined;
    }
    const inPage = (el) => Boolean(containerRef.current?.contains(el)) && !barRef.current?.contains(el);
    const tuck = () => !keepRef.current?.() && setTucked(true);
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key.length > 1 && !["Backspace", "Delete", "Enter", "Tab"].includes(e.key))) return;
      if (inPage(e.target) && typingPlace(e.target)) tuck();
    };
    const onWheel = (e) => inPage(e.target) && tuck();
    const onMove = (e) => {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r || e.clientX < r.left || e.clientX > r.right) return;
      if (edge === "bottom" ? r.bottom - e.clientY <= REVEAL : e.clientY - r.top <= REVEAL) setTucked(false);
    };
    const bar = barRef.current;
    const onFocus = () => setTucked(false);

    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("mousemove", onMove);
    bar?.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("mousemove", onMove);
      bar?.removeEventListener("focusin", onFocus);
    };
  }, [enabled, edge, containerRef, barRef]);

  return enabled && tucked;
}
