// Shortcuts that can be changed in Settings > Shortcuts. Each works only in
// its `context`: over or inside that part of the screen (the sidebar ones, on its selected item). Elsewhere the keys
// do what they normally do (Ctrl+Delete deletes the next word in text).
// A combo is a string like "Ctrl+Shift+Delete". `settings.shortcuts` keeps
// only the ones the user changed, by id.

export const BINDABLE = [
  { id: "tabs.closeHovered", label: "Close the tab under the mouse", context: "Tab bar", keys: "Ctrl+Delete" },
  { id: "sidebar.copy", label: "Copy the selected item", context: "Sidebar", keys: "Ctrl+C" },
  { id: "sidebar.paste", label: "Paste a copy", context: "Sidebar", keys: "Ctrl+V" },
  { id: "sidebar.delete", label: "Delete the selected item (asks first)", context: "Sidebar", keys: "Ctrl+Delete" },
];

// The app's fixed shortcuts. A bindable shortcut may not take one of these.
export const FIXED = [
  { label: "Show or hide the sidebar", keys: "Ctrl+\\" },
  { label: "Focus mode", keys: "Ctrl+." },
  { label: "Search", keys: "Ctrl+K" },
  { label: "New chat", keys: "Ctrl+J" },
  { label: "New page", keys: "Ctrl+N" },
  { label: "Go home", keys: "Ctrl+Shift+H" },
  { label: "Open settings", keys: "Ctrl+," },
];

// Taken too, though not listed: Ctrl+E edits the layout.
const UNLISTED = [{ label: "Edit layout", keys: "Ctrl+E" }];

const MODIFIERS = ["Control", "Meta", "Shift", "Alt", "AltGraph", "OS"];
const NAMES = { " ": "Space", Esc: "Escape", Del: "Delete" };

// The combo a key press makes, or null for a lone modifier. Cmd counts as
// Ctrl, as it does for the fixed shortcuts.
export function comboOf(e) {
  if (!e.key || MODIFIERS.includes(e.key)) return null;
  const key = NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  // Shift is already in a symbol ("?"), not in a letter or a named key.
  const shift = e.shiftKey && (key.length > 1 || /[A-Z]/.test(key));
  return [(e.ctrlKey || e.metaKey) && "Ctrl", e.altKey && "Alt", shift && "Shift", key].filter(Boolean).join("+");
}

// "sidebar.deleteHovered" is the old id of "sidebar.delete"; a saved change carries over.
export const keysOf = (shortcuts, id) =>
  shortcuts?.[id] ?? (id === "sidebar.delete" ? shortcuts?.["sidebar.deleteHovered"] : undefined) ?? BINDABLE.find((b) => b.id === id)?.keys;

// Whether a key press is the shortcut `id`. Held keys repeat; a repeat never
// counts, so one press acts once.
export const matches = (e, shortcuts, id) => !e.repeat && comboOf(e) === keysOf(shortcuts, id);

// What else `keys` is taken by: a fixed shortcut, or another bindable one in
// the same context. Shortcuts in different contexts may share keys.
export function clashes(shortcuts, id, keys) {
  const { context } = BINDABLE.find((b) => b.id === id);
  return [
    ...[...FIXED, ...UNLISTED].filter((f) => f.keys === keys).map((f) => f.label),
    ...BINDABLE.filter((b) => b.id !== id && b.context === context && keysOf(shortcuts, b.id) === keys).map((b) => b.label),
  ];
}
