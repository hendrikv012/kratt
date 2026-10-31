// Quick find ranking. Pure: no React, no app state.
// A FindItem is { id, group, title, subtitle?, color?, keywords?, text?, run }.

export const GROUPS = ["Pages", "Subjects", "Folders", "Tools", "Commands", "Actions"];
export const GROUP_LIMIT = 6;

// 0 for no match; otherwise higher is better:
// title prefix > title word prefix > title substring > keyword > body text.
export function score(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = item.title.toLowerCase();
  if (title.startsWith(q)) return 100;
  if (title.split(/[\s\-_/]+/).some((word) => word.startsWith(q))) return 80;
  if (title.includes(q)) return 60;
  if (item.keywords?.some((k) => k.toLowerCase().includes(q))) return 40;
  if (item.text?.toLowerCase().includes(q)) return 20;
  return 0;
}

// Groups in a fixed order, best match first, at most GROUP_LIMIT each. Ties go
// to whatever was opened most recently. With no query, shows the recent items.
export function searchItems(items, query, recentIds = []) {
  const rank = (item) => {
    const at = recentIds.indexOf(item.id);
    return at === -1 ? Infinity : at;
  };

  if (!query.trim()) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const recent = recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, GROUP_LIMIT);
    return recent.length ? [{ group: "Recent", items: recent }] : [];
  }

  const scored = items.map((item) => ({ item, score: score(item, query) })).filter((s) => s.score > 0);
  return GROUPS.map((group) => ({
    group,
    items: scored
      .filter((s) => s.item.group === group)
      .sort((a, b) => b.score - a.score || rank(a.item) - rank(b.item))
      .slice(0, GROUP_LIMIT)
      .map((s) => s.item),
  })).filter((g) => g.items.length);
}
