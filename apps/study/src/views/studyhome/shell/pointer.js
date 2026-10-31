// Where the mouse last was, for shortcuts that act on what's under it. A key
// press carries no position, and after a tab closes another one slides under
// a still mouse without any pointer event, so this looks again on each press.

let last = null;
let users = 0;
const onMove = (e) => (last = { x: e.clientX, y: e.clientY });
const onOut = (e) => !e.relatedTarget && (last = null); // left the window

// Starts tracking; call the returned function to stop.
export function trackPointer() {
  if (users++ === 0) {
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerout", onOut, true);
  }
  return () => {
    if (--users > 0) return;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerout", onOut, true);
    last = null;
  };
}

// The closest element matching `selector` under the mouse, or null.
export function underPointer(selector) {
  if (!last || typeof document.elementFromPoint !== "function") return null;
  return document.elementFromPoint(last.x, last.y)?.closest(selector) ?? null;
}

// What a context shortcut acts on: the item under the mouse, else the one
// holding focus.
export const targetOf = (e, selector) => underPointer(selector) ?? e.target?.closest?.(selector) ?? null;
