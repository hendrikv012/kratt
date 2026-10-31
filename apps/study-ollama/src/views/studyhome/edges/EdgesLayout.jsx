import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { LANES, LANE_WIDTH, SIZES, addWidget, allowedIn, fitSideWidths, kindLayout, moveWidget, removeWidget, setLaneWidth, setSize } from "./lanes";
import { EXTENSION_EMPTY, groupBySource, useWidgetDefs } from "../widgets/registry";
import WidgetFrame from "../widgets/WidgetFrame";
import { Button } from "../ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { motionReduced, useLaneDrag } from "./useLaneDrag";
import "./edges.css";

// Every screen: four widget lanes (left, right, top, bottom) around a middle
// that stays free. `layout` is the settings group `layout`; this screen's
// arrangement is layout.kinds[kind] over its defaults, and every change goes
// out through onLayout(next), or onLayout(null) for the defaults.
// `center` is the screen's content, or a function of { insets } (the lane
// boxes measured from the edges, in px). `context` reaches the widgets ({ pageId, home }).

const LANE_LABELS = { left: "Left edge", right: "Right edge", top: "Top edge", bottom: "Bottom edge" };
const SIZE_NAMES = { s: "Small", m: "Medium", l: "Large" };
const VERTICAL = { left: true, right: true, top: false, bottom: false };
const SIZE_STEP = 56;
const WIDTH_STEP = 16;
const FLIP_MS = 200;
const EASE = "cubic-bezier(.16,1,.3,1)";
const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Siblings slide from where they were to where they are (FLIP). capture()
// measures before a change; the layout effect plays it after the render.
function useFlip(rootRef) {
  const first = useRef(null);
  const keyOf = (el) => el.dataset.slot ?? "placeholder";
  const items = (root) => [...root.querySelectorAll("[data-slot], [data-placeholder]")].filter((el) => !el.dataset.dragging);
  const capture = useCallback(() => {
    const root = rootRef.current;
    if (!root || motionReduced(root)) return;
    first.current = new Map(items(root).map((el) => [keyOf(el), el.getBoundingClientRect()]));
  }, [rootRef]);
  useLayoutEffect(() => {
    const was = first.current;
    const root = rootRef.current;
    first.current = null;
    if (!was || !root) return;
    for (const el of items(root)) {
      const a = was.get(keyOf(el));
      if (!a || typeof el.animate !== "function") continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: FLIP_MS, easing: EASE });
    }
  });
  return capture;
}

// The lane boxes, measured from the layout's edges, for content under them.
function useInsets(rootRef, kl, deps) {
  const [insets, setInsets] = useState(NO_INSETS);
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const box = (lane) => root.querySelector(`[data-lane="${lane}"]`)?.getBoundingClientRect();
    const has = (lane) => kl.current.lanes[lane].length > 0 && box(lane);
    const next = {
      left: has("left") ? Math.round(box("left").right - r.left) : 0,
      right: has("right") ? Math.round(r.right - box("right").left) : 0,
      top: has("top") ? Math.round(box("top").bottom - r.top) : 0,
      bottom: has("bottom") ? Math.round(r.bottom - box("bottom").top) : 0,
    };
    setInsets((cur) => (same(cur, next) ? cur : next));
  }, [rootRef, kl]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, deps);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    root.querySelectorAll("[data-lane]").forEach((el) => ro.observe(el));
    return () => ro.disconnect?.();
  }, [rootRef, measure]);
  return insets;
}

// The layout's inner width (inside its padding), or null before it's measured.
function useInnerWidth(rootRef) {
  const [width, setWidth] = useState(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const s = window.getComputedStyle(root);
      setWidth(Math.round(root.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect?.();
  }, [rootRef]);
  return width;
}

// A pointer pull (a size handle or a lane's inner line): follows the pointer
// until it goes up (done(true)), or Escape or unmount call it off (done(false)).
function usePull() {
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(false), []);
  return (onMove, done) => {
    stop.current?.(false);
    const end = (keep) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", off);
      window.removeEventListener("keydown", key, true);
      stop.current = null;
      done(keep);
    };
    const up = () => end(true);
    const off = () => end(false);
    const key = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", off);
    window.addEventListener("keydown", key, true);
    stop.current = end;
  };
}

function AddWidgetMenu({ ids, defs, onAdd }) {
  const [builtin, extension] = groupBySource(ids);
  const item = (id) => {
    const def = defs[id];
    const Icon = def.icon;
    return (
      <DropdownMenuItem key={id} onSelect={() => onAdd(id)}>
        {Icon && <Icon aria-hidden="true" />}
        {def.title}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Plus />
          Add widget
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto">
        <DropdownMenuLabel>Built in</DropdownMenuLabel>
        {builtin.items.length ? builtin.items.map(item) : <p className="px-2 py-1.5 text-xs text-st-muted-foreground">Every built-in widget is already here.</p>}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>From extensions</DropdownMenuLabel>
        {extension.items.length ? extension.items.map(item) : <p className="px-2 py-1.5 text-xs text-st-muted-foreground">{EXTENSION_EMPTY}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EditBar({ addable, defs, onAdd, onResetKind, onResetAll, onDone }) {
  return (
    <div className="st-edges-bar" role="toolbar" aria-label="Edit layout">
      <span className="st-edges-bar-hint">Drag widgets to any edge</span>
      <AddWidgetMenu ids={addable} defs={defs} onAdd={onAdd} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <RotateCcw />
            Reset
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Reset to default</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onResetKind}>This screen</DropdownMenuItem>
          {onResetAll && <DropdownMenuItem onSelect={onResetAll}>Everything, sidebar and tabs included</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

export default function EdgesLayout({ kind, center, layout, onLayout, editing = false, onEditing, onResetAll, context }) {
  const defs = useWidgetDefs();
  const kl = useMemo(() => kindLayout(layout, kind, defs), [layout, kind, defs]);
  const klRef = useRef(kl);
  klRef.current = kl;
  const [sizing, setSizing] = useState(null); // { id, size, x, y } while a size handle is pulled
  const [width, setWidth] = useState(null); // { lane, px } while a lane's inner line is pulled
  const refocus = useRef(null);
  const pull = usePull();
  // Cards animate in when the screen opens. After the first change here they
  // don't, so a card moved to another lane (a new element) just slides.
  const [settled, setSettled] = useState(false);

  // Handlers only; `flip` (below) exists by the time any of them runs.
  const commit = (next) => {
    if (next === klRef.current || same(next, klRef.current)) return;
    flip();
    setSettled(true);
    onLayout?.(next);
  };

  const { rootRef, drag, handleProps } = useLaneDrag({
    onDrop: (id, lane, index) => commit(moveWidget(klRef.current, id, lane, index, defs)),
    onBeforeChange: () => flip(),
    accepts: (id, lane) => allowedIn(defs[id], lane),
  });
  const flip = useFlip(rootRef);
  const inner = useInnerWidth(rootRef);
  const insets = useInsets(rootRef, klRef, [kl, width, sizing, editing, drag, inner]);

  // Keyboard moves keep the focus on the header that moved.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    rootRef.current?.querySelector(`[data-slot="${CSS.escape(id)}"] :is(.st-wf-head, .st-wf[data-bare])`)?.focus();
  });

  const onMenu = (id, action) => {
    const cur = klRef.current;
    if (action.type === "move") commit(moveWidget(cur, id, action.lane, Infinity, defs));
    else if (action.type === "size") commit(setSize(cur, id, action.size));
    else if (action.type === "remove") commit(removeWidget(cur, id));
  };

  const onHandleKey = (e, id, lane) => {
    if (e.target !== e.currentTarget) return;
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const list = klRef.current.lanes[lane];
    const to = list.indexOf(id) + step;
    if (to < 0 || to >= list.length) return;
    refocus.current = id;
    commit(moveWidget(klRef.current, id, lane, to, defs));
  };

  // Pulling a card's edge snaps between small, medium and large.
  const startSize = (e, id, lane) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const i0 = Math.max(0, SIZES.indexOf(klRef.current.size[id] ?? "m"));
    const v = VERTICAL[lane];
    const s0 = v ? e.clientY : e.clientX;
    let cur = i0;
    const move = (ev) => {
      const i = clamp(i0 + Math.round(((v ? ev.clientY : ev.clientX) - s0) / SIZE_STEP), 0, SIZES.length - 1);
      if (i !== cur) {
        cur = i;
        flip();
      }
      setSizing({ id, size: SIZES[i], x: ev.clientX, y: ev.clientY });
    };
    pull(move, (keep) => {
      if (cur !== i0) flip();
      setSizing(null);
      if (keep && cur !== i0) commit(setSize(klRef.current, id, SIZES[cur]));
    });
    setSizing({ id, size: SIZES[i0], x: e.clientX, y: e.clientY });
  };

  // A side lane's inner line sets its width, by pointer or arrow keys.
  const widthOf = (lane) => (width?.lane === lane ? width.px : kl.widths[lane]);
  // A lane holds something when a card stays in it or one is being dragged over it.
  const occupied = (lane) => kl.lanes[lane].some((id) => id !== drag?.id) || drag?.lane === lane;
  const shown = fitSideWidths(inner, occupied("left") ? widthOf("left") : 0, occupied("right") ? widthOf("right") : 0);
  const startWidth = (e, lane) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const w0 = klRef.current.widths[lane];
    const sign = lane === "left" ? 1 : -1;
    const sx = e.clientX;
    let px = w0;
    const move = (ev) => {
      px = clamp(Math.round(w0 + (ev.clientX - sx) * sign), LANE_WIDTH.min, LANE_WIDTH.max);
      setWidth({ lane, px });
    };
    pull(move, (keep) => {
      setWidth(null);
      if (keep && px !== w0) commit(setLaneWidth(klRef.current, lane, px));
    });
  };
  const onWidthKey = (e, lane) => {
    const d = { ArrowRight: WIDTH_STEP, ArrowLeft: -WIDTH_STEP }[e.key];
    if (!d) return;
    e.preventDefault();
    commit(setLaneWidth(klRef.current, lane, klRef.current.widths[lane] + d * (lane === "left" ? 1 : -1)));
  };

  const placed = new Set(LANES.flatMap((l) => kl.lanes[l]));
  const addable = Object.keys(defs).filter((id) => !placed.has(id) && (!defs[id].page || kind === "page"));
  const add = (id) => {
    refocus.current = id;
    commit(addWidget(kl, id, defs[id]?.lanes === "edge" ? "bottom" : "right", defs));
  };
  const resetKind = () => {
    if (same(kl, kindLayout(undefined, kind, defs))) return;
    flip();
    setSettled(true);
    onLayout?.(null);
  };

  const sizeOf = (id) => (sizing?.id === id ? sizing.size : kl.size[id] ?? "m");
  const arranging = editing || Boolean(drag);

  const placeholder = (lane) => (
    <div
      key="placeholder"
      className="st-placeholder"
      data-placeholder
      data-size={sizeOf(drag.id)}
      aria-hidden="true"
      style={VERTICAL[lane] ? { height: Math.min(drag.height, 220) } : { height: Math.min(drag.height, 140) }}
    />
  );

  const slot = (id, lane, i) => (
    <div
      key={id}
      className="st-slot"
      data-slot={id}
      data-size={sizeOf(id)}
      data-dragging={drag?.id === id || undefined}
      data-sizing={sizing?.id === id || undefined}
      style={{ "--i": i }}
    >
      <WidgetFrame
        id={id}
        lane={lane}
        size={sizeOf(id)}
        onMenu={(action) => onMenu(id, action)}
        handleProps={{ ...handleProps(id), onKeyDown: (e) => onHandleKey(e, id, lane) }}
        context={context}
      />
      <span className="st-size-handle" data-size-handle aria-hidden="true" onPointerDown={(e) => startSize(e, id, lane)} />
    </div>
  );

  const laneEl = (lane) => {
    const ids = kl.lanes[lane];
    const here = drag?.lane === lane;
    const children = [];
    let k = 0;
    let placed = false;
    for (const id of ids) {
      const dragged = drag?.id === id;
      if (here && !dragged && !placed && k === drag.index) {
        children.push(placeholder(lane));
        placed = true;
      }
      children.push(slot(id, lane, k));
      if (!dragged) k += 1;
    }
    if (here && !placed) children.push(placeholder(lane));
    const empty = k === 0 && !here;
    const side = lane === "left" || lane === "right";
    return (
      <div
        key={lane}
        className="st-lane"
        data-lane={lane}
        data-drop-lane={lane}
        data-empty={empty || undefined}
        data-lifted={drag?.from === lane || undefined}
        role="region"
        aria-label={LANE_LABELS[lane]}
      >
        <div className="st-lane-in">{children}</div>
        {side && !empty && (
          <div
            className="st-lane-width"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize the ${lane} edge`}
            aria-valuemin={LANE_WIDTH.min}
            aria-valuemax={LANE_WIDTH.max}
            aria-valuenow={widthOf(lane)}
            tabIndex={0}
            onPointerDown={(e) => startWidth(e, lane)}
            onKeyDown={(e) => onWidthKey(e, lane)}
            data-active={width?.lane === lane || undefined}
          />
        )}
        {arranging && empty && (
          <div className="st-zone" data-drop-lane={lane}>
            <span>Drop widgets here</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="st-edges-wrap" data-editing={editing || undefined}>
      {editing && (
        <EditBar addable={addable} defs={defs} onAdd={add} onResetKind={resetKind} onResetAll={onResetAll} onDone={() => onEditing?.(false)} />
      )}
      <div
        ref={rootRef}
        className="st-edges"
        data-kind={kind}
        data-settled={settled || undefined}
        data-arranging={arranging || undefined}
        data-resizing={width ? true : undefined}
        style={{ "--st-lw": `${shown.left || widthOf("left")}px`, "--st-rw": `${shown.right || widthOf("right")}px` }}
      >
        <div className="st-edges-center" data-edges-center>
          {typeof center === "function" ? center({ insets }) : center}
        </div>
        {LANES.map(laneEl)}
      </div>
      {sizing && (
        <div className="st-size-bubble" style={{ left: sizing.x + 14, top: sizing.y + 12 }} aria-hidden="true">
          {SIZE_NAMES[sizing.size]}
        </div>
      )}
    </div>
  );
}
