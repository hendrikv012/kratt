import { pathTo, UNSORTED } from "../data/tree";

const stripTags = (html = "") =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const nodesOfType = (study, type) => Object.values(study.state.nodes).filter((n) => n.type === type);

// Where a page or folder lives, as "Subject / Folder".
const place = ({ state, parents }, id) => {
  const trail = pathTo(state, parents, id).map((c) => state.nodes[c].name);
  return trail.length ? trail.join(" / ") : undefined;
};

// What quick find can open or run out of the box. `study` is useStudy(),
// `shell` is the ShellContext value. Providers return everything they have;
// search.js does the filtering.
export function builtinProviders(study, shell) {
  const { actions } = study;
  const open = (id) => () => shell.open({ view: "node", id });

  const pages = {
    id: "pages",
    items: () =>
      nodesOfType(study, "page").map((n) => ({
        id: n.id,
        group: "Pages",
        title: n.name,
        subtitle: place(study, n.id),
        text: stripTags(n.content),
        run: open(n.id),
      })),
  };

  const subjects = {
    id: "subjects",
    items: () =>
      nodesOfType(study, "subject").map((n) => ({ id: n.id, group: "Subjects", title: n.name, color: n.color, run: open(n.id) })),
  };

  const folders = {
    id: "folders",
    items: () =>
      nodesOfType(study, "folder").map((n) => ({
        id: n.id,
        group: "Folders",
        title: n.name,
        subtitle: place(study, n.id),
        run: open(n.id),
      })),
  };

  const action = (id, title, run, keywords) => ({ id: `action:${id}`, group: "Actions", title, keywords, run });
  const actionItems = {
    id: "actions",
    items: () =>
      [
        action("settings", "Open settings", () => shell.openSettings(), ["preferences", "options"]),
        action("new-page", "New page", () => shell.open({ view: "node", id: actions.addChild(UNSORTED, "page") }), ["create", "note"]),
        action("new-subject", "New subject", () => shell.startRename(actions.addSubject({ palette: shell.palette })), ["create", "course"]),
        action("sidebar", "Toggle sidebar", () => shell.toggleSidebar(), ["hide", "show"]),
        action("focus", "Focus mode", () => shell.toggleFocus(), ["distraction", "zen"]),
        // Only once the extensions screen exists.
        shell.openExtensions && action("extensions", "Open extensions", () => shell.openExtensions(), ["plugins", "add-ons"]),
      ].filter(Boolean),
  };

  return [pages, subjects, folders, actionItems];
}
