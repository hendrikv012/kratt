import { BarChart3, CalendarDays, Clock, FileText, History, Link2, List, Palette, Play, RotateCcw, StickyNote, Waypoints } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { subjectOf } from "../data/tree";
import { dueForReview, LEGEND_SAMPLES, masteryOpacity, masteryWord } from "../mastery";
import { QuickNoteInput } from "../views/QuickNotesView";
import ClockWidget from "../ClockWidget";
import ForceGraphView from "../graph/ForceGraphView";
import GraphTile from "../home/GraphTile";
import Kratt from "../kratt/Kratt";
import { ChatSummary, chatsByTime } from "../chats/summary";
import { registerWidget } from "./registry";
import "./widgets.css";

const Empty = ({ children }) => <p className="st-widget-empty">{children}</p>;

// A small dot drawn the same way as in the graph: hue is the subject,
// brightness is how well it's known, hollow means not learned yet.
export function MasteryDot({ color, mastery, size = 9 }) {
  const learned = mastery !== null;
  return (
    <span
      className="st-dot"
      style={{
        width: size,
        height: size,
        background: learned ? `color-mix(in srgb, ${color} ${Math.round(masteryOpacity(mastery) * 100)}%, transparent)` : "transparent",
        boxShadow: learned ? "none" : `inset 0 0 0 1.5px ${color}`,
      }}
    />
  );
}

// Widgets whose features don't exist yet say what will appear there.
export const ContinueWidget = () => (
  <Empty>Nothing in progress yet. Open a page and press Study to start.</Empty>
);

// Kratt fills Home's empty tiles: he hops while nothing is due.
const KrattEmpty = ({ size, mode, children }) => (
  <div className="st-kratt-empty">
    <Kratt size={size} mode={mode} />
    <span>{children}</span>
  </div>
);

export function ReviewWidget() {
  const { state } = useStudy();
  const { open } = useShell();
  const due = dueForReview(state);
  if (!due.length) return <KrattEmpty size={56} mode="hop">All caught up. Kratt is keeping watch until something starts to fade.</KrattEmpty>;
  return (
    <ul className="st-list">
      {due.map((id) => (
        <li key={id}>
          <button className="st-list-row" onClick={() => open({ view: "node", id })}>
            <span className="st-list-main st-truncate">{state.nodes[id]?.name || "Untitled"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export const DeadlinesWidget = () => (
  <Empty>No deadlines yet.</Empty>
);

// The newest chats, as on the Chats screen without its actions: 3 at 2×2, 1 at 2×1.
export function ChatsWidget({ size, compact }) {
  const { state } = useStudy();
  const shell = useShell();
  const chats = chatsByTime(state.chats).slice(0, size === "2x1" || compact ? 1 : 3);
  if (!chats.length) return <KrattEmpty size={40}>No chats yet. Kratt is ready when you are.</KrattEmpty>;
  const now = Date.now();
  return (
    <ul className="st-list">
      {chats.map((chat) => (
        <li key={chat.id}>
          <button className="st-list-row st-chats-main" onClick={() => shell.chat?.open(chat.id)}>
            <ChatSummary chat={chat} now={now} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export const ThisWeekWidget = () => (
  <Empty>Your study time and topics learned will show here.</Empty>
);

export function RecentPagesWidget({ compact }) {
  const { state, parents } = useStudy();
  const { open } = useShell();
  const pages = state.recent.slice(0, compact ? 2 : 6);
  return (
    <>
      {pages.length === 0 ? (
        <Empty>Pages you open will appear here.</Empty>
      ) : (
        <ul className="st-list">
          {pages.map((id) => (
            <li key={id}>
              {/* The page icon takes its subject's color, as its dot does in the graph. */}
              <button className="st-list-row" onClick={() => open({ view: "node", id })}>
                <FileText
                  size={14}
                  className="st-list-icon"
                  style={{ color: state.nodes[subjectOf(state, parents, id)].color }}
                  aria-hidden="true"
                />
                <span className="st-list-main st-truncate">{state.nodes[id].name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function QuickNotesWidget({ compact }) {
  const { state } = useStudy();
  const { open } = useShell();
  const notes = state.quickNotes.slice(0, compact ? 1 : 3);
  return (
    <>
      <QuickNoteInput />
      {notes.length > 0 && (
        <ul className="st-list st-quick-preview">
          {notes.map((n) => (
            <li key={n.id} className="st-truncate">{n.text}</li>
          ))}
        </ul>
      )}
      <button className="st-ghost-button st-widget-foot" onClick={() => open({ view: "quick-notes" })}>
        {state.quickNotes.length ? `All notes (${state.quickNotes.length})` : "Open notes"}
      </button>
    </>
  );
}

export function LegendWidget() {
  const rows = [LEGEND_SAMPLES.known, LEGEND_SAMPLES.shaky, LEGEND_SAMPLES.weak, null].map((m) => [masteryWord(m), m]);
  return (
    <div className="st-legend" role="group" aria-label="Legend">
      {rows.map(([word, mastery]) => (
        <span key={word} className="st-legend-item">
          <MasteryDot color="var(--st-text-soft)" mastery={mastery} size={9} />
          {word}
        </span>
      ))}
    </div>
  );
}

// `title` is given where the widget is shown without a frame, so the title
// and the button share one row.
export function LocalGraphWidget({ pageId, title }) {
  const shell = useShell();
  return (
    <>
      <div className="st-local-graph-head" data-end={title ? undefined : true}>
        {title && <span>{title}</span>}
        <button className="st-ghost-button" onClick={() => shell.open({ view: "graph" })}>Open graph</button>
      </div>
      <div className="st-local-graph">
        <ForceGraphView variant="local" focusId={pageId} settings={shell.graph} />
      </div>
    </>
  );
}

// Sources have no links to pages yet, so there is nothing to list.
export const PageSourcesWidget = () => <Empty>No sources linked to this page yet.</Empty>;

// The h1 to h3 headings of a page, read from its HTML.
export function pageHeadings(html) {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("h1, h2, h3")]
    .map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim() }))
    .filter((h) => h.text);
}

export function OutlineWidget({ pageId }) {
  const { state } = useStudy();
  const headings = pageHeadings(state.nodes[pageId]?.content);
  if (headings.length === 0) return <Empty>No headings on this page yet.</Empty>;
  return (
    <ul className="st-list st-outline">
      {headings.map((h, i) => (
        <li key={i} className="st-truncate" style={{ paddingLeft: (h.level - 1) * 12 }}>{h.text}</li>
      ))}
    </ul>
  );
}

const ClockBody = ({ home, size }) => <ClockWidget home={home} size={size} />;

const def = (title, icon, Component, extra = {}) => ({ title, icon, source: "builtin", lanes: "any", size: "m", Component, ...extra });

// Latest chats wears Kratt as its icon.
const KrattIcon = () => <Kratt size={16} />;

export const BUILTIN_WIDGETS = {
  graph: def("Graph", Waypoints, GraphTile, { size: "l", bare: true, sizes: ["2x2", "4x2", "6x2"], homeSize: "4x2" }),
  continue: def("Continue studying", Play, ContinueWidget, { size: "s", sizes: ["2x1", "2x2"], homeSize: "2x1" }),
  review: def("Due for review", RotateCcw, ReviewWidget, { size: "s", sizes: ["2x1", "2x2"], homeSize: "2x2" }),
  deadlines: def("Deadlines and exams", CalendarDays, DeadlinesWidget, { size: "s", sizes: ["1x1", "2x1"], homeSize: "2x1" }),
  chats: def("Latest chats", KrattIcon, ChatsWidget, { size: "s", sizes: ["2x1", "2x2"], homeSize: "2x2" }),
  notes: def("Notes", StickyNote, QuickNotesWidget, { size: "s", sizes: ["2x1", "2x2"], homeSize: "2x1" }),
  recent: def("Recent pages", History, RecentPagesWidget, { size: "s", sizes: ["2x1", "2x2"], homeSize: "2x1" }),
  week: def("This week", BarChart3, ThisWeekWidget, { size: "s", sizes: ["2x1", "2x2"], homeSize: "2x1" }),
  clock: def("Clock", Clock, ClockBody, { size: "s", bare: true, sizes: ["1x1", "2x1", "2x2"], homeSize: "2x1" }),
  legend: def("Legend", Palette, LegendWidget, { size: "l", bare: true, home: false }),
  local: def("Connected to this page", Waypoints, LocalGraphWidget, { lanes: "side", page: true }),
  pagesrc: def("Sources for this page", Link2, PageSourcesWidget, { lanes: "side", size: "s", page: true }),
  outline: def("On this page", List, OutlineWidget, { lanes: "side", size: "s", page: true }),
};

for (const [id, d] of Object.entries(BUILTIN_WIDGETS)) registerWidget(id, d);
