// The "Pin to sidebar" / "Unpin" menu item for a page, shared by the page's
// own menu and its tab's menu.
export function pinItem(state, actions, id) {
  return state.pinned.includes(id)
    ? { label: "Unpin", onSelect: () => actions.unpinPage(id) }
    : { label: "Pin to sidebar", onSelect: () => actions.pinPage(id) };
}
