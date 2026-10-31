import { useCallback, useLayoutEffect, useRef } from "react";
import { motionReduced } from "../motion";

// A copy of the FLIP helper in edges/EdgesLayout.jsx, for the Home grid editor.
const FLIP_MS = 200;
const EASE = "cubic-bezier(.16,1,.3,1)";

// Tiles (`[data-slot]` under rootRef) slide from where they were to where
// they are (FLIP). capture() measures before a change; the layout effect
// plays it after the render.
export function useFlip(rootRef) {
  const first = useRef(null);
  const items = (root) => [...root.querySelectorAll("[data-slot]")];
  const capture = useCallback(() => {
    const root = rootRef.current;
    if (!root || motionReduced(root)) return;
    first.current = new Map(items(root).map((el) => [el.dataset.slot, el.getBoundingClientRect()]));
  }, [rootRef]);
  useLayoutEffect(() => {
    const was = first.current;
    const root = rootRef.current;
    first.current = null;
    if (!was || !root) return;
    for (const el of items(root)) {
      const a = was.get(el.dataset.slot);
      if (!a || typeof el.animate !== "function") continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: FLIP_MS, easing: EASE });
    }
  });
  return capture;
}
