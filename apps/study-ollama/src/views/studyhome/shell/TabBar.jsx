import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "../ui/context-menu";

// Tabs look like shadcn Tabs: a muted rail with the active tab raised onto the
// background. Tabs drag to reorder; the others slide into place briefly.

const DRAG_START = 4;
const SLIDE_MS = 150;

const closable = (id) => id.startsWith("node:") || id.startsWith("source:");

function motionReduced(el) {
  return (
    Boolean(el?.closest(".study[data-reduce-motion]")) ||
    (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}

// A tab's right-click menu; with no items the tab is left alone.
function TabMenu({ items, children }) {
  if (!items?.length) return children;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item) => (
          <ContextMenuItem key={item.label} onSelect={item.onSelect}>
            {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// `menuFor(id)` gives a tab's right-click items ({ label, onSelect }).
// `auto` lays the bar over the content (the parent must be positioned) and
// slides it away unless `shown`; `barRef` gives the parent the bar's element.
export default function TabBar({ tabs, onSelect, onClose, onReorder, tools, lead, at = "top", labelOf = (id) => id, menuFor, auto = false, shown = true, barRef }) {
  const rail = useRef(null);
  const setRail = (el) => {
    rail.current = el;
    if (barRef) barRef.current = el;
  };
  const wraps = useRef(new Map());
  const lefts = useRef(new Map());
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(null); // { id, dx }

  const tabButton = (id) => wraps.current.get(id)?.querySelector('[role="tab"]');

  // After a reorder, slide every moved tab from where it was to where it is.
  useLayoutEffect(() => {
    const reduced = motionReduced(rail.current);
    wraps.current.forEach((el, id) => {
      const left = el.getBoundingClientRect().left;
      const was = lefts.current.get(id);
      lefts.current.set(id, left);
      if (reduced || was === undefined || Math.abs(was - left) < 1 || drag.current?.id === id) return;
      el.style.transition = "none";
      el.style.transform = `translateX(${was - left}px)`;
      el.getBoundingClientRect(); // commit the start position
      el.style.transition = `transform ${SLIDE_MS}ms ease-out`;
      el.style.transform = "";
    });
  }, [tabs.list]);

  const targetIndex = (state, dx) => {
    const centre = state.rect.left + state.rect.width / 2 + dx;
    let index = 0;
    for (const id of tabs.list) {
      if (id === state.id) continue;
      const r = state.rects.get(id);
      if (r && r.left + r.width / 2 < centre) index += 1;
    }
    return Math.max(1, index); // Home stays first
  };

  const onPointerDown = (e, id) => {
    if (e.button !== 0 || id === "home" || e.target.closest("[data-close]")) return;
    const rects = new Map(tabs.list.map((t) => [t, tabButton(t)?.getBoundingClientRect()]));
    drag.current = { id, startX: e.clientX, rect: rects.get(id), rects, active: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.active && Math.abs(dx) < DRAG_START) return;
    d.active = true;
    setDragging({ id: d.id, dx });
  };

  const finish = (e, commit) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(null);
    if (!d.active) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (!commit) return;
    const to = targetIndex(d, e.clientX - d.startX);
    if (to !== tabs.list.indexOf(d.id)) onReorder?.(d.id, to);
  };

  const refocus = useRef(false);
  // After a keyboard close, put focus on the tab that is now active.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    tabButton(tabs.active)?.focus();
  }, [tabs.list, tabs.active]);

  const onKeyDown = (e, i) => {
    if (e.key === "Delete" && closable(tabs.list[i])) {
      e.preventDefault();
      refocus.current = true;
      onClose?.(tabs.list[i]);
      return;
    }
    const last = tabs.list.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tabButton(tabs.list[next])?.focus();
  };

  return (
    <div
      ref={setRail}
      data-at={at}
      data-auto={auto || undefined}
      data-shown={auto ? String(shown) : undefined}
      className={cn(
        "st-tabbar flex h-11 flex-none items-center gap-2 px-3 text-st-muted-foreground",
        at === "bottom" ? "border-t border-st-border" : "border-b border-st-border",
        auto && "absolute inset-x-0 z-30 bg-st-background",
        auto && (at === "bottom" ? "bottom-0" : "top-0")
      )}
    >
      {lead}
      <div
        role="tablist"
        aria-label="Open tabs"
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-st bg-st-muted p-[3px]"
      >
        {tabs.list.map((id, i) => {
          const active = id === tabs.active;
          const label = labelOf(id);
          const lifted = dragging?.id === id;
          return (
            <TabMenu key={id} items={menuFor?.(id)}>
              <div
                ref={(el) => (el ? wraps.current.set(id, el) : wraps.current.delete(id))}
                className={cn("group relative flex-none", lifted && "z-10 rounded-st-sm shadow-md")}
                style={lifted ? { transform: `translateX(${dragging.dx}px)`, transition: "none" } : undefined}
                onPointerDown={(e) => onPointerDown(e, id)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => finish(e, true)}
                onPointerCancel={(e) => finish(e, false)}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  title={label}
                  aria-keyshortcuts={closable(id) ? "Delete" : undefined}
                  onClick={() => !suppressClick.current && onSelect?.(id)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  className={cn(
                    "inline-flex h-7 max-w-[11rem] items-center whitespace-nowrap rounded-st-sm px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring",
                    closable(id) && "pr-7",
                    active ? "bg-st-background text-st-foreground" : "hover:text-st-foreground"
                  )}
                >
                  <span className="truncate">{label}</span>
                </button>
                {closable(id) && (
                  <button
                    type="button"
                    data-close
                    aria-label={`Close ${label}`}
                    tabIndex={-1}
                    onClick={() => onClose?.(id)}
                    className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-st-sm opacity-60 hover:bg-st-accent hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
            </TabMenu>
          );
        })}
      </div>
      <div className="ml-auto flex flex-none items-center gap-1">{tools}</div>
    </div>
  );
}
