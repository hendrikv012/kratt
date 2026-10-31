import { useCallback, useEffect, useRef, useState } from "react";
import { motionReduced } from "../motion";

export { motionReduced };

// Dragging widgets between lanes. Attach `rootRef` to the layout; lanes (and
// the drop areas of empty lanes) carry data-drop-lane="<lane>", each widget's
// slot carries data-slot="<id>", and handleProps(id) goes on its drag handle.
//
// The drag starts after 5px. The card follows the pointer (position: fixed)
// while `drag` = { id, from, lane, index, width, height } tells the layout
// where to draw the placeholder. Letting go over a lane glides the card into
// the placeholder and calls onDrop(id, lane, index); letting go outside every
// lane, or Escape, glides it home and calls onCancel(). `accepts(id, lane)`
// says whether a lane may take the widget; one that may not counts as outside.
// `onBeforeChange` runs just before the placeholder moves, so the layout can
// measure for its FLIP.

const START_DISTANCE = 5;
const GLIDE_MS = 180;
const EASE = "cubic-bezier(.16,1,.3,1)";
const VERTICAL = { left: true, right: true, top: false, bottom: false };
const SKIP = "button, input, textarea, select, a, [contenteditable='true'], [data-size-handle]";

const inside = (r, x, y) => r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

function laneAt(root, x, y) {
  for (const el of root.querySelectorAll("[data-drop-lane]")) {
    if (inside(el.getBoundingClientRect(), x, y)) return el.dataset.dropLane;
  }
  return null;
}

// How many of the lane's other cards come before the pointer.
function indexIn(root, lane, id, x, y) {
  const laneEl = root.querySelector(`[data-drop-lane="${lane}"]`);
  if (!laneEl) return 0;
  const cards = [...laneEl.querySelectorAll("[data-slot]")].filter((el) => el.dataset.slot !== id);
  const v = VERTICAL[lane];
  return cards.filter((el) => {
    const r = el.getBoundingClientRect();
    return v ? y > r.top + r.height / 2 : x > r.left + r.width / 2;
  }).length;
}

const FIXED_KEYS = ["position", "left", "top", "width", "height", "zIndex", "margin", "pointerEvents"];

export function useLaneDrag(options) {
  const rootRef = useRef(null);
  const latest = useRef(options);
  latest.current = options;
  const [drag, setDragState] = useState(null);
  const current = useRef(null);
  const session = useRef(null);

  // Moves the placeholder (or ends the drag with null); a no-op does nothing.
  const setDrag = useCallback((next) => {
    const d = current.current;
    if (d && next && d.lane === next.lane && d.index === next.index) return;
    latest.current.onBeforeChange?.();
    current.current = next;
    setDragState(next);
  }, []);

  // The lane under the pointer, if it may take this widget.
  const laneFor = (id, x, y) => {
    const lane = laneAt(rootRef.current, x, y);
    return lane && (latest.current.accepts?.(id, lane) ?? true) ? lane : null;
  };

  const release = (s) => {
    window.removeEventListener("pointermove", s.move);
    window.removeEventListener("pointerup", s.up);
    window.removeEventListener("pointercancel", s.cancel);
    window.removeEventListener("keydown", s.key, true);
  };

  const unfix = (el) => {
    FIXED_KEYS.forEach((k) => (el.style[k] = ""));
  };

  // Glide the card into the placeholder, then report.
  const land = (s, report) => {
    release(s);
    s.landing = true;
    const finish = () => {
      if (session.current !== s) return;
      session.current = null;
      unfix(s.el);
      report();
      setDrag(null);
    };
    const target = rootRef.current?.querySelector("[data-placeholder]")?.getBoundingClientRect();
    if (!target || motionReduced(s.el) || typeof s.el.animate !== "function") return finish();
    const cur = s.el.getBoundingClientRect();
    const glide = s.el.animate(
      [
        { left: `${cur.left}px`, top: `${cur.top}px`, width: `${cur.width}px` },
        { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px` },
      ],
      { duration: GLIDE_MS, easing: EASE }
    );
    glide.onfinish = finish;
    glide.oncancel = finish;
  };

  const cancel = (s) => {
    if (!s.started) {
      release(s);
      session.current = null;
      return;
    }
    // Settled now, so a pointer up before the glide starts can't drop it.
    release(s);
    s.landing = true;
    // The placeholder goes back home first, so the card glides there.
    setDrag({ ...current.current, lane: s.from, index: s.fromIndex });
    s.over = null;
    const report = () => latest.current.onCancel?.();
    if (motionReduced(s.el) || typeof s.el.animate !== "function") land(s, report);
    else requestAnimationFrame(() => land(s, report));
  };

  const begin = (s) => {
    s.started = true;
    const r = s.rect;
    Object.assign(s.el.style, {
      position: "fixed",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      zIndex: "60",
      margin: "0",
      pointerEvents: "none",
    });
    s.over = { lane: s.from, index: s.fromIndex };
    setDrag({ id: s.id, from: s.from, lane: s.from, index: s.fromIndex, width: r.width, height: r.height });
  };

  const start = (e, id) => {
    if (e.button !== 0 || session.current || !rootRef.current) return;
    if (e.target !== e.currentTarget && e.target.closest?.(SKIP)) return;
    const el = e.currentTarget.closest("[data-slot]");
    const from = el?.closest("[data-drop-lane]")?.dataset.dropLane;
    if (!el || !from) return;
    const laneEl = el.closest("[data-drop-lane]");
    const s = {
      id,
      el,
      from,
      fromIndex: [...laneEl.querySelectorAll("[data-slot]")].indexOf(el),
      sx: e.clientX,
      sy: e.clientY,
      rect: el.getBoundingClientRect(),
      started: false,
      landing: false,
      over: null,
    };
    s.ox = e.clientX - s.rect.left;
    s.oy = e.clientY - s.rect.top;
    s.move = (ev) => {
      if (s.landing) return;
      if (!s.started) {
        if (Math.hypot(ev.clientX - s.sx, ev.clientY - s.sy) < START_DISTANCE) return;
        begin(s);
      }
      s.el.style.left = `${ev.clientX - s.ox}px`;
      s.el.style.top = `${ev.clientY - s.oy}px`;
      const lane = laneFor(s.id, ev.clientX, ev.clientY);
      // Outside every lane the placeholder waits back home.
      const next = lane ? { lane, index: indexIn(rootRef.current, lane, s.id, ev.clientX, ev.clientY) } : { lane: s.from, index: s.fromIndex };
      s.over = lane ? next : null;
      setDrag({ ...current.current, ...next });
    };
    s.up = (ev) => {
      if (!s.started) {
        release(s);
        session.current = null;
        return;
      }
      if (s.landing) return;
      const lane = laneFor(s.id, ev.clientX, ev.clientY);
      if (!lane) return cancel(s);
      const index = s.over?.lane === lane ? s.over.index : indexIn(rootRef.current, lane, s.id, ev.clientX, ev.clientY);
      land(s, () => latest.current.onDrop?.(s.id, lane, index));
    };
    s.cancel = () => cancel(s);
    s.key = (ev) => {
      if (ev.key !== "Escape" || !s.started || s.landing) return;
      ev.preventDefault();
      ev.stopPropagation();
      cancel(s);
    };
    session.current = s;
    window.addEventListener("pointermove", s.move);
    window.addEventListener("pointerup", s.up);
    window.addEventListener("pointercancel", s.cancel);
    window.addEventListener("keydown", s.key, true);
  };

  // A layout that goes away mid-drag leaves nothing behind.
  useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      release(s);
      unfix(s.el);
      session.current = null;
      current.current = null;
    },
    []
  );

  const handleProps = (id) => ({ onPointerDown: (e) => start(e, id) });
  return { rootRef, drag, handleProps };
}
