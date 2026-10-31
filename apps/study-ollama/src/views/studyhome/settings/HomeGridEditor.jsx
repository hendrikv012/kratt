import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { useShell } from "../ShellContext";
import { MISSING, useWidgetDefs } from "../widgets/registry";
import { moveTile, setTileSize, sizesOf, spanOf } from "../home/grid";
import { useFlip } from "../home/useFlip";
import { Segmented } from "./controls";

// Settings > Layout and home screen > Home screen: a scaled copy of the Home
// grid. Tiles show their title and icon. Drag one, or focus it and press
// Space, the arrows and Space again (Escape puts it back), to change the
// order; clicking one shows its sizes. Every change saves through
// shell.layoutApi, which offers Undo.

const DRAG_START = 4;
const sizeLabel = (size) => size.replace("x", "×");
const sameOrder = (a, b) => a.order.join("\n") === b.order.join("\n");

export default function HomeGridEditor() {
  const { layoutApi: api } = useShell();
  const defs = useWidgetDefs();
  const saved = api.homeLayout();
  // While a tile is being moved, the order shown is a draft; dropping it saves.
  const [draft, setDraftState] = useState(null);
  const draftRef = useRef(null);
  const [held, setHeld] = useState(null); // { id, start } while moving with the keyboard
  const [dragging, setDragging] = useState(null);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("");
  const rootRef = useRef(null);
  const refocus = useRef(null);
  const flip = useFlip(rootRef);

  const hl = draft ?? saved;
  const defOf = (id) => defs[id] ?? MISSING;
  const titleOf = (id) => defOf(id).title;
  const place = (id, layout) => `place ${layout.order.indexOf(id) + 1} of ${layout.order.length}`;

  const setDraft = (next) => {
    flip();
    draftRef.current = next;
    setDraftState(next);
  };
  // Drops the draft, saving it if the order changed.
  const finish = (id, start) => {
    const next = draftRef.current;
    draftRef.current = null;
    setDraftState(null);
    if (!next) return;
    setStatus(`${titleOf(id)} dropped, ${place(id, next)}`);
    if (!sameOrder(next, start)) api.saveHome(next);
  };
  // Drops the draft without saving.
  const putBack = (id) => {
    flip();
    draftRef.current = null;
    setDraftState(null);
    setHeld(null);
    setDragging(null);
    setStatus(`${titleOf(id)} put back`);
  };

  // The pointer drag in progress: { id, stop() }, where stop() removes its
  // window listeners.
  const dragRef = useRef(null);
  // Closing Settings mid-drag abandons it: the drop must not save.
  useEffect(
    () => () => {
      dragRef.current?.stop();
      dragRef.current = null;
    },
    []
  );

  // A tile that moved keeps the focus.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    rootRef.current?.querySelector(`[data-slot="${CSS.escape(id)}"]`)?.focus();
  });

  // Escape cancels a keyboard move or a pointer drag. It is caught before the
  // Settings dialog sees it (that listens on the document), so the dialog
  // stays open.
  useEffect(() => {
    if (!held && !dragging) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (dragging) {
        dragRef.current?.stop();
        dragRef.current = null;
        putBack(dragging);
      } else if (e.target?.dataset?.slot === held.id) {
        refocus.current = held.id;
        putBack(held.id);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });

  const onKeyDown = (e, id) => {
    if (e.key === " ") {
      e.preventDefault();
      if (held?.id === id) {
        setHeld(null);
        finish(id, held.start);
      } else if (!held && !dragging) {
        setHeld({ id, start: saved });
        draftRef.current = saved;
        setDraftState(saved);
        setStatus(`${titleOf(id)} picked up, ${place(id, saved)}`);
      }
      return;
    }
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!step || held?.id !== id) return;
    e.preventDefault();
    const cur = draftRef.current;
    const next = moveTile(cur, id, cur.order.indexOf(id) + step);
    // At either end nothing moves, but the place is said again.
    if (next !== cur) {
      refocus.current = id;
      setDraft(next);
    }
    setStatus(`${titleOf(id)}, ${place(id, next)}`);
  };

  // Space would also click the button when released; picking up is not a click.
  const onKeyUp = (e) => {
    if (e.key === " ") e.preventDefault();
  };

  // Focus leaving a held tile puts it back. A blur while the tile itself is
  // being moved in the DOM (refocus pending) is not the user leaving.
  const onBlur = (id) => {
    if (held?.id === id && refocus.current !== id) putBack(id);
  };

  // Dragging with the pointer reorders live; the drop saves.
  const onPointerDown = (e, id) => {
    if (e.button !== 0 || held || dragRef.current) return;
    const start = saved;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let lastOver = null;
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
        started = true;
        draftRef.current = start;
        setDraftState(start);
        setDragging(id);
      }
      const over = document.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.("[data-slot]");
      const overId = over && rootRef.current?.contains(over) ? over.dataset.slot : null;
      // Wait until the pointer leaves the tile it just swapped with, so a
      // tile sliding under it doesn't swap them straight back.
      if (!overId || overId === id || overId === lastOver) {
        if (overId !== lastOver) lastOver = null;
        return;
      }
      lastOver = overId;
      const cur = draftRef.current;
      setDraft(moveTile(cur, id, cur.order.indexOf(overId)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const up = () => {
      stop();
      dragRef.current = null;
      if (!started) return;
      setDragging(null);
      finish(id, start);
    };
    // The browser took the pointer away (a scroll, a lost window): no drop.
    const cancel = () => {
      stop();
      dragRef.current = null;
      if (started) putBack(id);
    };
    dragRef.current = { id, stop };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const chosen = selected && hl.order.includes(selected) ? selected : null;

  return (
    <div className="st-hge">
      <div ref={rootRef} className="st-hge-grid">
        {hl.order.map((id) => {
          const size = hl.size[id];
          const { w, h } = spanOf(size);
          const Icon = defOf(id).icon;
          return (
            <button
              key={id}
              type="button"
              data-slot={id}
              data-held={held?.id === id || dragging === id || undefined}
              aria-label={`${titleOf(id)}, ${sizeLabel(size)}`}
              aria-pressed={chosen === id}
              className="st-hge-tile"
              style={{ "--w": w, "--h": h }}
              onClick={() => setSelected(id)}
              onKeyDown={(e) => onKeyDown(e, id)}
              onKeyUp={onKeyUp}
              onBlur={() => onBlur(id)}
              onPointerDown={(e) => onPointerDown(e, id)}
            >
              {Icon && <Icon size={14} aria-hidden="true" />}
              <span>{titleOf(id)}</span>
            </button>
          );
        })}
      </div>
      <p className="st-hge-hint">Drag a tile, or focus it and press Space, the arrow keys and Space again. Click a tile to resize it.</p>
      <div role="status" aria-label="Tile moves" className="sr-only">
        {status}
      </div>
      <div className="st-hge-bar">
        {chosen && (
          <Segmented
            size="sm"
            label={`Size of ${titleOf(chosen)}`}
            value={hl.size[chosen]}
            onChange={(size) => {
              const next = setTileSize(saved, chosen, size, defs);
              if (next !== saved) api.saveHome(next);
            }}
            options={sizesOf(defOf(chosen)).map((s) => ({ value: s, label: sizeLabel(s) }))}
          />
        )}
        <Button variant="ghost" size="sm" className="ml-auto border border-st-border" onClick={() => api.resetHome()}>
          <RotateCcw />
          Reset home screen
        </Button>
      </div>
    </div>
  );
}
