import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/page.css";
import "./styles/intro.css";
import "./styles/motion.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import Sidebar from "./sidebar/Sidebar";
import ChatPanel from "./chats/ChatPanel";
import Kratt from "./kratt/Kratt";
import { TopBarClock } from "./ClockWidget";
import EdgesLayout from "./edges/EdgesLayout";
import { kindOfTab } from "./edges/lanes";
import HomeGrid from "./home/HomeGrid";
import { addTile, homeLayout, homeTileList, removeTile } from "./home/grid";
import { useWidgetDefs } from "./widgets/registry";
import ContainerView from "./views/ContainerView";
import PageView from "./views/PageView";
import QuickNotesView from "./views/QuickNotesView";
import ChatsView from "./chats/ChatsView";
import SourcesView from "./sources/SourcesView";
import SourceView from "./sources/SourceView";
import GraphTab from "./graph/GraphTab";
import DeleteDialog from "./dialogs/DeleteDialog";
import LinkDialog from "./dialogs/LinkDialog";
import QuickFind from "./quickfind/QuickFind";
import Toasts, { useToasts } from "./Toasts";
import { builtinProviders } from "./quickfind/builtinProviders";
import SettingsDialog, { SECTIONS } from "./settings/SettingsDialog";
import { ExtensionsProvider } from "./extensions/ExtensionsProvider";
import ExtensionsView from "./extensions/ExtensionsView";
import { useContributions } from "./extensions/useContributions";
import { StudyProvider, useStudy } from "./data/StudyProvider";
import { ShellContext } from "./ShellContext";
import { DEFAULTS, useSettings } from "./useSettings";
import { useTheme } from "./theme/useTheme";
import { SUBJECT_COLORS } from "./data/operations";
import VaultBanner from "./VaultBanner";
import Splash from "./kratt/Splash";
import TabBar from "./shell/TabBar";
import { useTabs } from "./shell/useTabs";
import { isPinned, routeOf, tabIdOf } from "./shell/tabs";
import { pinItem } from "./shell/pinItem";
import { useAutoHide } from "./shell/useAutoHide";
import { useWorkHide } from "./shell/useWorkHide";
import { createAiService } from "./ai/onClient";
import { titleOf } from "./sources/SourcesView";
import { Button } from "./ui/button";

/**
 * The study app (?view=study-preview, dev builds). Data is saved inside
 * the app. Query params set the starting state for captures:
 *   sidebar=hidden, focus=1, ai=1,
 *   settings=<section id>
 *
 * Shortcuts: Ctrl+\ sidebar, Ctrl+. focus mode, Ctrl+, settings, Ctrl+K quick find,
 * Ctrl+E edit layout (on Home: Settings at the home screen), Ctrl+J new chat.
 */
const TEXT_SCALE = { small: 0.93, normal: 1, large: 1.1 };

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const settings = params.get("settings");
  return {
    sidebarHidden: params.get("sidebar") === "hidden",
    focus: params.get("focus") === "1",
    ai: params.get("ai") === "1",
    settings: SECTIONS.some((s) => s.id === settings) ? settings : null,
  };
}

const VIEW_TITLES = {
  home: "Home",
  graph: "Graph",
  "quick-notes": "Notes",
  sources: "Sources",
  extensions: "Extensions",
  chats: "Chats",
};

const INTRO_LENGTH = 2300;

// Whether the opening plays: Settings allow it and motion isn't reduced.
const openingPlays = (appearance) =>
  appearance.openingAnimation && !appearance.reduceMotion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The opening animation: on at launch when `openingPlays`; starts once the
// opening screen is gone (`splashDone`), and ends on its own, or at the first
// click or key press.
function useIntro(appearance, splashDone) {
  const [intro, setIntro] = useState(() => openingPlays(appearance));
  useEffect(() => {
    if (!intro || !splashDone) return;
    const end = () => setIntro(false);
    const timer = setTimeout(end, INTRO_LENGTH);
    window.addEventListener("pointerdown", end, { once: true });
    window.addEventListener("keydown", end, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", end);
      window.removeEventListener("keydown", end);
    };
  }, [intro, splashDone]);
  return intro && splashDone;
}

// The sidebar follows Settings > Appearance unless Ctrl+\ overrode it.
// Changing the setting drops the override (React's "reset state when a
// prop changes" pattern), so the setting always wins.
function useSidebar(setting, startHidden) {
  const [override, setOverride] = useState(startHidden ? false : null);
  const [seenSetting, setSeenSetting] = useState(setting);
  if (setting !== seenSetting) {
    setSeenSetting(setting);
    setOverride(null);
  }
  return [override ?? setting === "pinned", setOverride];
}

// What a route shows in the middle. Views without a screen of their own
// yet (null) show Home.
function centerOf(route, state) {
  if (route.view === "node" && state.nodes[route.id]) {
    return state.nodes[route.id].type === "page" ? <PageView id={route.id} /> : <ContainerView id={route.id} fresh={route.fresh} />;
  }
  if (route.view === "quick-notes") return <QuickNotesView />;
  if (route.view === "graph") return <GraphTab />;
  if (route.view === "sources") return <SourcesView />;
  if (route.view === "source" && state.sources.some((s) => s.id === route.id)) return <SourceView id={route.id} />;
  if (route.view === "extensions") return <ExtensionsView />;
  if (route.view === "chats") return <ChatsView />;
  return null;
}

function Screen({ route, layout, home, onLayout, editing, onEditing, onResetAll, onEditHome }) {
  const { state } = useStudy();
  // Home is the snap grid; every other kind of screen keeps its own lanes.
  const own = centerOf(route, state);
  const kind = own ? kindOfTab(tabIdOf(route), state) : "home";
  const pageId = kind === "page" ? route.id : undefined;
  const context = useMemo(() => ({ pageId, home }), [pageId, home]);
  if (!own) return <HomeGrid layout={layout} context={context} onEditHome={onEditHome} />;
  return (
    <EdgesLayout
      kind={kind}
      center={own}
      layout={layout}
      onLayout={(next) => onLayout(kind, next)}
      editing={editing}
      onEditing={onEditing}
      onResetAll={onResetAll}
      context={context}
    />
  );
}

function Shell({ settingsState, splashDone }) {
  const [initial] = useState(readParams);
  const [settings, set, reset] = settingsState;
  const { appearance } = settings;
  const study = useStudy();
  const { state, actions } = study;
  // One AI service for the app, so each extension's rate limit outlives its frame.
  const aiAddress = useRef(settings.ai.onUrl);
  aiAddress.current = settings.ai.onUrl;
  const aiLocal = useRef(settings.ai.model === "local");
  aiLocal.current = settings.ai.model === "local";
  const ai = useMemo(
    () => createAiService({ client: study.client, address: () => aiAddress.current, local: () => aiLocal.current }),
    [study.client]
  );
  // The service starts Ollama at launch when the AI runs on this computer, so it needs to know
  // where the AI runs, which is chosen in the browser's settings.
  useEffect(() => {
    study.client.setLocalAi?.({ local: settings.ai.model === "local" }).catch(() => {});
  }, [study.client, settings.ai.model]);
  const { themes: extensionThemes } = useContributions();
  const { bridgeStyle, scheme, pixel } = useTheme(appearance, extensionThemes);
  const rootStyle = useMemo(
    () => ({ ...bridgeStyle, "--st-scale": TEXT_SCALE[appearance.textSize] ?? 1 }),
    [bridgeStyle, appearance.textSize]
  );
  const tabState = useTabs(settings.layout.tabs, (tabs) => set("layout", { tabs }), state);
  const { route } = tabState;
  const [pinned, setPinned] = useSidebar(appearance.sidebar, initial.sidebarHidden);
  const [peeking, setPeeking] = useState(false);
  const [draggingSide, setDraggingSide] = useState(false);
  const [focus, setFocus] = useState(initial.focus);
  const [aiOpen, setAiOpen] = useState(initial.ai || !settings.ai.chatHidden);
  // The chat in Kratt Chat (null: a new one, saved at its first question). `session` changes
  // each time a chat is opened or a new one started.
  const [chat, setChat] = useState({ id: null, session: 0 });
  const [settingsSection, setSettingsSection] = useState(initial.settings);
  const [renamingId, setRenamingId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [finding, setFinding] = useState(false);
  const [editing, setEditing] = useState(false);
  const defs = useWidgetDefs();
  // The last 8 places opened (node ids, or the view name), newest first.
  const [recentIds, setRecentIds] = useState([]);
  // Find lists recent pages when its box is empty, so start from the saved ones.
  const seededRecent = useRef(false);
  useEffect(() => {
    if (seededRecent.current || !state.recent.length) return;
    seededRecent.current = true;
    setRecentIds((ids) => [...ids, ...state.recent.filter((id) => !ids.includes(id))].slice(0, 8));
  }, [state.recent]);
  const providersRef = useRef(new Set());
  // The sidebar item Ctrl+C copied: { id, parentId }.
  const [clipboard, setClipboard] = useState(null);
  const { items: toasts, toast, dismiss: dismissToast } = useToasts();
  const layoutToast = useRef(null);
  const intro = useIntro(appearance, splashDone);

  const showPinned = pinned && !focus;
  const onHome = !centerOf(route, state);
  const side = appearance.sidebarSide;
  const setSide = (sidebarSide) => set("appearance", { sidebarSide });
  const mainRef = useRef(null);
  const barRef = useRef(null);
  const autoBar = appearance.tabBar === "auto";

  const showChat = (open) => {
    setAiOpen(open);
    set("ai", { chatHidden: !open });
  };
  const chatApi = {
    activeId: chat.id,
    // Settings > AI, for asking Kratt outside the panel (/Kratt in a note).
    address: settings.ai.onUrl,
    memory: settings.ai.chatMemory,
    open: (id) => {
      setChat((c) => ({ id, session: c.session + 1 }));
      showChat(true);
    },
    newChat: () => {
      setChat((c) => ({ id: null, session: c.session + 1 }));
      showChat(true);
    },
  };

  useEffect(() => {
    const shortcuts = {
      "\\": () => setPinned(!pinned),
      ".": () => setFocus((f) => !f),
      ",": () => setSettingsSection((s) => s ?? "appearance"),
      k: () => setFinding(true),
      j: () => chatApi.newChat(),
      // Edit layout is off in focus mode and behind Settings. Home has no
      // lanes, so there it opens the home screen's editor in Settings.
      e: () => !focus && !settingsSection && (onHome ? setSettingsSection("layout") : setEditing((on) => !on)),
    };
    // Ctrl+E is also the editor's inline code, and Ctrl+J shouldn't leave a half-typed
    // text, so typing places keep both.
    const typing = (e) => e.defaultPrevented || Boolean(e.target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
    const onKey = (e) => {
      const action = (e.ctrlKey || e.metaKey) && shortcuts[e.key];
      if (!action || ((e.key === "e" || e.key === "j") && typing(e))) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addFindProvider = useCallback((provider) => {
    providersRef.current.add(provider);
    return () => providersRef.current.delete(provider);
  }, []);

  // Every layout change says "Layout saved" and can be undone. Only the
  // newest one stays: Undo on an older one would also drop the changes made
  // after it.
  const layoutSaved = (undo) => {
    dismissToast(layoutToast.current);
    layoutToast.current = toast("Layout saved", { label: "Undo", run: undo });
  };

  // `next` null puts the kind back on its defaults.
  const saveKind = (kind, next) => {
    const prev = settings.layout.kinds?.[kind];
    const write = (value) =>
      set("layout", (cur) => {
        const kinds = { ...cur.kinds };
        if (value == null) delete kinds[kind];
        else kinds[kind] = value;
        return { kinds };
      });
    write(next);
    layoutSaved(() => write(prev));
  };

  // `next` null puts Home back on its default grid.
  const saveHome = (next) => {
    const prev = settings.layout.home;
    set("layout", { home: next });
    layoutSaved(() => set("layout", { home: prev }));
  };

  // Every screen's lanes, the Home grid, the sidebar and the tab bar go back
  // to how they started. Open tabs stay open.
  const resetAll = () => {
    const { kinds, home, sideWidth, tabsAt } = settings.layout;
    const { sidebar, sidebarSide, tabBar } = appearance;
    set("layout", { kinds: {}, home: DEFAULTS.layout.home, sideWidth: DEFAULTS.layout.sideWidth, tabsAt: DEFAULTS.layout.tabsAt });
    set("appearance", { sidebar: DEFAULTS.appearance.sidebar, sidebarSide: DEFAULTS.appearance.sidebarSide, tabBar: DEFAULTS.appearance.tabBar });
    layoutSaved(() => {
      set("layout", { kinds, home, sideWidth, tabsAt });
      set("appearance", { sidebar, sidebarSide, tabBar });
    });
  };

  // Settings > Layout and home screen works through this.
  const layoutApi = {
    editLayout: () => {
      setSettingsSection(null);
      setEditing(true);
    },
    resetAll,
    homeLayout: () => homeLayout(settings.layout.home, defs),
    saveHome,
    resetHome: () => saveHome(null),
    homeWidgets: () => homeTileList(homeLayout(settings.layout.home, defs), defs),
    setHomeWidget: (id, on) => {
      const hl = homeLayout(settings.layout.home, defs);
      const next = on ? addTile(hl, id, defs) : removeTile(hl, id);
      if (next !== hl) saveHome(next);
    },
  };

  const shell = useMemo(
    () => ({
      intro,
      palette: SUBJECT_COLORS,
      graph: settings.graphView,
      setGraph: (patch) => set("graphView", patch),
      ai,
      route,
      open: (next) => {
        tabState.open(next);
        setPeeking(false);
        if (next.view === "node") actions.visit(next.id);
        const key = next.view === "node" ? next.id : next.view;
        setRecentIds((ids) => [key, ...ids.filter((id) => id !== key)].slice(0, 8));
      },
      openFind: () => setFinding(true),
      openSettings: (section = "appearance") => setSettingsSection(section),
      openExtensions: () => {
        tabState.open({ view: "extensions" });
        setPeeking(false);
        setSettingsSection(null);
      },
      toggleSidebar: () => setPinned(!pinned),
      toggleFocus: () => setFocus((f) => !f),
      addFindProvider,
      toast,
      renamingId,
      startRename: setRenamingId,
      stopRename: () => setRenamingId(null),
      clipboard,
      setClipboard,
      askDelete: (id, parentId) => setDialog({ kind: "delete", id, parentId }),
      askLink: (pageId) => setDialog({ kind: "link", id: pageId }),
      shortcuts: settings.shortcuts,
      // Pinning to the tab bar, by tab id ("node:<id>", "graph", …).
      tabPins: { has: (id) => isPinned(tabState.tabs, id), pin: tabState.pin, unpin: tabState.unpin },
      editing,
      layoutApi,
      chat: chatApi,
    }),
    // layoutApi and chatApi are rebuilt every render with the settings and chat they read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intro, settings.graphView, set, ai, route, tabState.open, tabState.tabs, tabState.pin, tabState.unpin, settings.shortcuts, renamingId, clipboard, actions, pinned, setPinned, addFindProvider, toast, editing, settings.layout, appearance, defs, chat]
  );

  // The bar stays while the layout is being edited (`shell.editing`).
  // A menu opened from the bar leaves its trigger marked as expanded.
  const keepBar = () => Boolean(shell.editing) || Boolean(barRef.current?.querySelector('[aria-expanded="true"]'));
  const barShown = useAutoHide({
    enabled: autoBar && !focus,
    edge: settings.layout.tabsAt === "bottom" ? "bottom" : "top",
    containerRef: mainRef,
    barRef,
    keepOpen: keepBar,
  });
  const barTucked = useWorkHide({
    enabled: Boolean(appearance.tabBarHideWhileWorking) && !focus,
    edge: settings.layout.tabsAt === "bottom" ? "bottom" : "top",
    containerRef: mainRef,
    barRef,
    keepOpen: keepBar,
  });

  const labelOf = (id) => {
    const { view, id: target } = routeOf(id);
    if (view === "node") return state.nodes[target]?.name || "Untitled";
    if (view === "source") return titleOf(state.sources.find((x) => x.id === target) ?? {});
    return VIEW_TITLES[view] ?? id;
  };

  // Every tab but Home can be pinned to the tab bar; page tabs can also be
  // pinned to the sidebar.
  const menuFor = (id) => {
    if (id === "home") return undefined;
    const { view, id: target } = routeOf(id);
    const barPin = isPinned(tabState.tabs, id)
      ? { label: "Unpin from tab bar", onSelect: () => tabState.unpin(id) }
      : { label: "Pin to tab bar", onSelect: () => tabState.pin(id) };
    return view === "node" && state.nodes[target]?.type === "page" ? [barPin, pinItem(state, actions, target)] : [barPin];
  };

  const tabBar = (
    <TabBar
      tabs={tabState.tabs}
      labelOf={labelOf}
      menuFor={menuFor}
      at={settings.layout.tabsAt}
      auto={autoBar}
      shown={barShown && !barTucked}
      tucked={barTucked}
      barRef={barRef}
      shortcuts={settings.shortcuts}
      centre={appearance.tabBarClock && <TopBarClock hours={settings.home.clock.hours} />}
      onSelect={tabState.select}
      onClose={tabState.close}
      onReorder={tabState.reorder}
      lead={
        !showPinned && (
          <Button variant="ghost" size="iconSm" onClick={() => setPinned(true)} aria-label="Show sidebar (Ctrl+\)">
            {side === "left" ? <ChevronsRight /> : <ChevronsLeft />}
          </Button>
        )
      }
      tools={
        <>
          <Button variant="ghost" size="iconSm" onClick={() => setFinding(true)} aria-label="Search">
            <Search />
          </Button>
          <button className="st-ghost-button st-chat-toggle" onClick={() => showChat(!aiOpen)} aria-pressed={aiOpen}>
            <Kratt size={18} />
            Kratt Chat
          </button>
        </>
      }
    />
  );

  // Built when the box opens, so extension providers added since show up.
  const providers = useMemo(
    () => (finding ? [...builtinProviders(study, shell), ...providersRef.current] : []),
    [finding, study, shell]
  );

  return (
    <ShellContext.Provider value={shell}>
      <div
        className="study"
        data-st-scheme={scheme}
        data-pixel={pixel || undefined}
        data-kratt-still={appearance.krattMoves === false || undefined}
        data-side={side}
        data-reduce-motion={appearance.reduceMotion || undefined}
        data-focus={focus || undefined}
        data-intro={intro || undefined}
        style={rootStyle}
      >
        {/* When not pinned, hovering the sidebar's edge peeks it in, like Notion. */}
        {!showPinned && <div className="st-edge" data-side={side} onPointerEnter={() => setPeeking(true)} />}
        {(showPinned || peeking) && (
          <Sidebar
            floating={!showPinned}
            side={side}
            sections={settings.layout.sidebar}
            onSide={setSide}
            onDrag={setDraggingSide}
            onCollapse={() => {
              setPinned(false);
              setPeeking(false);
            }}
            onOpenSettings={() => {
              setPeeking(false);
              setSettingsSection("appearance");
            }}
            onPointerLeave={showPinned || draggingSide ? undefined : () => setPeeking(false)}
          />
        )}

        {/* While the layout is edited, a "Show near the edge" bar stays out and
            the content moves clear of it, so it covers no edit controls. */}
        <div className="st-main" ref={mainRef} data-bar-room={autoBar && editing && !focus ? (settings.layout.tabsAt === "bottom" ? "bottom" : "top") : undefined}>
          {!focus && settings.layout.tabsAt !== "bottom" && tabBar}

          <VaultBanner />
          <main className="st-content">
            <Screen
              key={route.id ?? route.view}
              route={route}
              layout={settings.layout}
              home={settings.home}
              onLayout={saveKind}
              editing={editing && !focus}
              onEditing={setEditing}
              onResetAll={resetAll}
              onEditHome={() => setSettingsSection("layout")}
            />
          </main>
          {!focus && settings.layout.tabsAt === "bottom" && tabBar}
        </div>

        <ChatPanel
          open={aiOpen}
          onClose={() => showChat(false)}
          width={settings.ai.panelWidth}
          onWidth={(panelWidth) => set("ai", { panelWidth })}
          chatId={chat.id}
          session={chat.session}
          onChatId={(id) => setChat((c) => ({ ...c, id }))}
          address={settings.ai.onUrl}
          local={settings.ai.model === "local"}
          memory={settings.ai.chatMemory}
        />

        {dialog?.kind === "delete" && state.nodes[dialog.id] && (
          <DeleteDialog id={dialog.id} parentId={dialog.parentId} onDone={() => setDialog(null)} />
        )}
        {dialog?.kind === "link" && state.nodes[dialog.id] && <LinkDialog pageId={dialog.id} onDone={() => setDialog(null)} />}

        <QuickFind open={finding} onClose={() => setFinding(false)} providers={providers} recentIds={recentIds} />

        {settingsSection && (
          <SettingsDialog
            section={settingsSection}
            onSection={setSettingsSection}
            onClose={() => setSettingsSection(null)}
            settings={settings}
            set={set}
            reset={reset}
            toasts={toasts}
          />
        )}

        {!settingsSection && <Toasts items={toasts} />}
      </div>
    </ShellContext.Provider>
  );
}

// `client` talks to the Study folder service (tests pass a fake); `children` render inside
// the store, which tests use to reach it.
export default function StudyPreview({ client, children } = {}) {
  // Settings are read here once and shared, so the provider and the shell
  // never hold two copies that overwrite each other's saved changes.
  const settingsState = useSettings();
  const { appearance } = settingsState[0];
  // The opening screen covers the app until the folder is open (and its sequence has played).
  const [phase, setPhase] = useState("loading");
  const [splashDone, setSplashDone] = useState(false);
  const [animate] = useState(() => openingPlays(appearance));
  const done = useCallback(() => setSplashDone(true), []);
  return (
    <>
      <StudyProvider client={client} onPhase={setPhase} renderGate={() => null}>
        <ExtensionsProvider catalogUrl={settingsState[0].extensions.catalogUrl}>
          <Shell settingsState={settingsState} splashDone={splashDone} />
        </ExtensionsProvider>
        {children}
      </StudyProvider>
      {!splashDone && <Splash phase={phase} animate={animate} appearance={appearance} onDone={done} />}
    </>
  );
}
