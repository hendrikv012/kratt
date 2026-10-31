import { useEffect, useRef } from "react";
import { Blocks, ChevronsLeft, ChevronsRight, GripVertical, Home, Library, MessageSquarePlus, Search, Settings, StickyNote, Waypoints } from "lucide-react";
import SubjectTree from "./SubjectTree";
import ChatsSection from "./ChatsSection";
import ReviewSection from "./ReviewSection";
import PinnedSection from "./PinnedSection";
import Kratt from "../kratt/Kratt";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { loadFont } from "../theme/fonts";
import "./sidebar.css";

function NavRow({ view, icon: Icon, label, count }) {
  const { route, open } = useShell();
  return (
    <button
      className="st-side-row"
      aria-current={route.view === view || (view === "sources" && route.view === "source") ? "page" : undefined}
      onClick={() => open({ view })}
    >
      <span className="st-side-chevron" />
      <Icon size={14} aria-hidden="true" />
      <span className="st-side-text">{label}</span>
      {count !== undefined && <span className="st-side-meta">{count}</span>}
    </button>
  );
}

const DRAG_START = 4;

export default function Sidebar({ side = "left", onSide, onDrag, sections = {}, floating, onCollapse, onOpenSettings, onPointerLeave }) {
  // Dragging the header past the middle of the window moves the sidebar to
  // that side. The grip button below does the same for the keyboard.
  const stopDrag = useRef(null);
  useEffect(() => () => stopDrag.current?.(), []);
  // The wordmark is Pixelify whatever the theme's font.
  useEffect(() => {
    loadFont("pixelify");
  }, []);
  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault(); // no text selection while dragging
    const startX = e.clientX;
    const end = () => {
      window.removeEventListener("mouseup", up);
      stopDrag.current = null;
      onDrag?.(false);
    };
    const up = (ev) => {
      end();
      if (Math.abs(ev.clientX - startX) < DRAG_START) return;
      onSide?.(ev.clientX > window.innerWidth / 2 ? "right" : "left");
    };
    stopDrag.current = end;
    window.addEventListener("mouseup", up);
    onDrag?.(true);
  };
  const { state } = useStudy();
  const shell = useShell();
  const other = side === "left" ? "right" : "left";
  const Collapse = side === "left" ? ChevronsLeft : ChevronsRight;
  return (
    <nav className="st-sidebar" data-floating={floating || undefined} data-side={side} aria-label="Sidebar" onPointerLeave={onPointerLeave}>
      <div className="st-side-head" onMouseDown={startDrag}>
        <div className="st-hopper st-workspace">
          <Kratt size={30} />
          <span className="st-wordmark">KRATT</span>
        </div>
        <button className="sr-only focus-visible:not-sr-only focus-visible:inline-flex focus-visible:h-7 focus-visible:w-7 focus-visible:items-center focus-visible:justify-center focus-visible:rounded-st-sm focus-visible:text-st-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring" onClick={() => onSide?.(other)} aria-label={`Move sidebar to the ${other}`}>
          <GripVertical size={16} />
        </button>
        <button className="st-icon-button" onClick={onCollapse} aria-label="Hide sidebar (Ctrl+\)">
          <Collapse size={16} />
        </button>
      </div>

      <button className="st-side-row st-side-find" onClick={() => shell.openFind?.()}>
        <Search size={14} aria-hidden="true" />
        <span className="st-side-text">Find</span>
        <span className="st-side-meta">Ctrl K</span>
      </button>

      <NavRow view="home" icon={Home} label="Home" />
      <NavRow view="graph" icon={Waypoints} label="Graph" />
      <NavRow view="quick-notes" icon={StickyNote} label="Notes" count={state.quickNotes.length} />

      <button className="st-side-newchat" onClick={() => shell.chat?.newChat?.()}>
        <MessageSquarePlus size={14} aria-hidden="true" />
        <span className="st-side-text">New chat</span>
        <span className="st-side-meta">Ctrl J</span>
      </button>

      {sections.chats !== false && <ChatsSection />}
      {sections.review !== false && <ReviewSection />}
      {sections.pinned !== false && <PinnedSection />}
      <SubjectTree />

      <NavRow view="sources" icon={Library} label="Sources" />
      <NavRow view="extensions" icon={Blocks} label="Extensions" />

      <div style={{ flex: 1 }} />
      <button className="st-side-row" onClick={onOpenSettings}>
        <span className="st-side-chevron" />
        <Settings size={14} aria-hidden="true" />
        <span className="st-side-text">Settings</span>
      </button>
    </nav>
  );
}
