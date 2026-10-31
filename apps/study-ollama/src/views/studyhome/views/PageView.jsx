import { useCallback, useEffect } from "react";
import { Link2 } from "lucide-react";
import Editor from "../../../editor/components/Editor.jsx";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { allPages, subjectOf } from "../data/tree";
import { masteryWord } from "../mastery";
import { MasteryDot } from "../widgets/builtin";
import TitleInput from "./TitleInput";
import Breadcrumb from "../shell/Breadcrumb";
import { pinItem } from "../shell/pinItem";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "../ui/context-menu";

// Lets the editor's [[ suggestions offer every page, and turns a click on a
// [[link]] into opening that page.
function usePageLinks() {
  const { state } = useStudy();
  const { open } = useShell();
  const pages = allPages(state);

  useEffect(() => {
    globalThis.__LOKUS_FILE_INDEX__ = pages.map((p) => ({ title: p.name, path: `${p.id}.md` }));
  });

  useEffect(() => {
    const onOpen = (e) => {
      const href = decodeURIComponent(e.detail ?? "");
      const target =
        state.nodes[href.replace(/\.md$/, "")] ?? pages.find((p) => p.name.trim().toLowerCase() === href.trim().toLowerCase());
      if (target) open({ view: "node", id: target.id });
    };
    window.addEventListener("lokus:open-file", onOpen);
    return () => window.removeEventListener("lokus:open-file", onOpen);
  });
}

export default function PageView({ id }) {
  const { state, parents, actions } = useStudy();
  const shell = useShell();
  const page = state.nodes[id];
  const places = parents[id] ?? [];
  usePageLinks();
  // Must stay the same function between renders: Lokus's editor rebuilds
  // itself when this changes, which would drop focus on every keystroke.
  const saveContent = useCallback((html) => actions.setContent(id, html), [actions, id]);

  const pin = pinItem(state, actions, id);

  return (
    <article className="st-page">
      {/* Right-click the header for the page's menu; the editor keeps its own. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <header>
            <Breadcrumb id={id} />
            <TitleInput id={id} />
          </header>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={pin.onSelect}>{pin.label}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div className="st-page-meta">
        <MasteryDot color={state.nodes[subjectOf(state, parents, id)].color} mastery={page.mastery} size={10} />
        <span>{masteryWord(page.mastery)}</span>
        <span className="st-page-meta-places">
          In
          {places.map((p) => (
            <button key={p} className="st-chip" onClick={() => shell.open({ view: "node", id: p })}>
              {state.nodes[p].name}
            </button>
          ))}
          <button className="st-chip st-chip-add" onClick={() => shell.askLink(id)}>
            <Link2 size={12} aria-hidden="true" /> Add to folder
          </button>
        </span>
      </div>
      <div className="st-editor">
        <Editor key={id} content={page.content} onContentChange={saveContent} />
      </div>
    </article>
  );
}
