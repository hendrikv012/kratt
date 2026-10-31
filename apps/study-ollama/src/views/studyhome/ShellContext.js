import { createContext, useContext } from "react";

// App-level navigation and dialogs, shared by the sidebar, views and graph.
//   intro             true while the opening animation plays
//   palette           colors new subjects get (SUBJECT_COLORS)
//   graph, setGraph   the graph's saved forces and filters (Settings > graph)
//   ai                the AI behind extensions' ai.ask: { ask(extensionId, prompt) },
//                     sent to Open Notebook through the Study folder service (ai/onClient.js)
//   route:            { view: "home" } | { view: "node", id, via } |
//                     { view: "quick-notes" } | { view: "sources" } | { view: "chats" }
//   open(route)       go somewhere; opening a page records it as recent
//   renamingId        the tree item whose name is being edited
//   startRename(id)   / stopRename()
//   askDelete(id, parentId)   show the delete options for an item
//   askLink(pageId)           pick another folder to link a page into
//   openSettings(section?)    open Settings, on "appearance" unless told otherwise
//   toggleSidebar() / toggleFocus()
//   addFindProvider(provider) add to Ctrl+K quick find; returns a function that
//                             removes it again. provider is
//                             { id, items: (ctx) => FindItem[] } where a FindItem is
//                             { id, group, title, subtitle?, color?, keywords?, text?, run }
//                             and group is Pages, Subjects, Folders, Tools,
//                             Commands or Actions. Return every candidate;
//                             quick find does the filtering.
//   openExtensions            (optional) when set, quick find offers "Open extensions"
//   toast(text, action?)      show a short message at the bottom centre for 4 s
//                             (at most 3 at once; the oldest goes first).
//                             action = { label: string, run: () => void } renders as a
//                             ghost button; clicking it calls run() once and dismisses the toast
export const ShellContext = createContext(null);
export const useShell = () => useContext(ShellContext);
