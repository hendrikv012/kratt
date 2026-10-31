// Whether motion should be instant: the OS asks for reduced motion, or
// Settings > Appearance > Reduce motion is on (`.study[data-reduce-motion]`
// around `el`).
export function motionReduced(el) {
  return (
    Boolean(el?.closest?.(".study[data-reduce-motion]")) ||
    (typeof window.matchMedia === "function" && Boolean(window.matchMedia("(prefers-reduced-motion: reduce)")?.matches))
  );
}
