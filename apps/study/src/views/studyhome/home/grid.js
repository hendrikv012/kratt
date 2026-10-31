// Snap-grid model for Home: an ordered list of tiles on a 6-column grid.
// Pure functions. Inputs are never mutated; unchanged results return the same object.

export const GRID_COLUMNS = 6;
export const TILE_SIZES = ["1x1", "2x1", "2x2", "4x2", "6x2"];
export const HOME_ORDER = ["graph", "clock", "continue", "review", "chats", "deadlines", "notes"];

export const spanOf = (size) => {
  const [w, h] = String(size).split("x").map(Number);
  return { w, h };
};

export const sizesOf = (def) => def?.sizes ?? ["2x1", "2x2"];
export const homeSizeOf = (def) => def?.homeSize ?? sizesOf(def)[0];

// Lanes saved by the Edges layout: read top, left, right, bottom.
export function fromLanes(lanes) {
  const order = [];
  for (const lane of ["top", "left", "right", "bottom"]) {
    const list = lanes?.[lane];
    if (!Array.isArray(list)) continue;
    for (const id of list) if (typeof id === "string" && !order.includes(id)) order.push(id);
  }
  return { order, size: {} };
}

export function homeLayout(saved, defs) {
  const raw = saved && typeof saved === "object" && Array.isArray(saved.order) ? saved.order : HOME_ORDER;
  const savedSize = saved && typeof saved.size === "object" && saved.size ? saved.size : {};
  const order = [];
  const size = {};
  for (const id of raw) {
    if (typeof id !== "string" || id in size) continue;
    order.push(id);
    size[id] = sizesOf(defs?.[id]).includes(savedSize[id]) ? savedSize[id] : homeSizeOf(defs?.[id]);
  }
  return { order, size };
}

export function moveTile(hl, id, index) {
  const from = hl.order.indexOf(id);
  if (from < 0) return hl;
  const rest = hl.order.filter((x) => x !== id);
  const i = Math.max(0, Math.min(Number.isFinite(index) ? index : rest.length, rest.length));
  if (i === from) return hl;
  return { ...hl, order: [...rest.slice(0, i), id, ...rest.slice(i)] };
}

export function setTileSize(hl, id, size, defs) {
  if (!hl.order.includes(id) || !sizesOf(defs?.[id]).includes(size) || hl.size[id] === size) return hl;
  return { ...hl, size: { ...hl.size, [id]: size } };
}

export function addTile(hl, id, defs) {
  if (typeof id !== "string" || hl.order.includes(id)) return hl;
  return { order: [...hl.order, id], size: { ...hl.size, [id]: homeSizeOf(defs?.[id]) } };
}

export function removeTile(hl, id) {
  if (!hl.order.includes(id)) return hl;
  const size = { ...hl.size };
  delete size[id];
  return { order: hl.order.filter((x) => x !== id), size };
}

export function homeTileList(hl, defs) {
  const out = hl.order.map((id) => ({ id, on: true }));
  for (const [id, def] of Object.entries(defs || {})) {
    if (!hl.order.includes(id) && !def.page && def.home !== false) out.push({ id, on: false });
  }
  return out;
}
