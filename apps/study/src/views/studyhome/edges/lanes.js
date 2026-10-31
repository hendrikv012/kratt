// Lanes model for the Edges layout: four widget lanes per screen kind.
// Pure functions. Inputs are never mutated; unchanged results return the same object.

export const LANES = ["left", "right", "top", "bottom"];
export const SIZES = ["s", "m", "l"];
export const LANE_WIDTH = { min: 220, max: 440, left: 272, right: 288 };

// Home is a snap grid (home/grid.js), not lanes.
export const KIND_DEFAULTS = {
  page: {
    lanes: { left: [], right: ["local", "pagesrc"], top: [], bottom: [] },
    size: { local: "m", pagesrc: "s" },
  },
  graph: {
    lanes: { left: [], right: [], top: [], bottom: ["legend"] },
    size: { legend: "l" },
  },
};

// A narrow window squeezes the side lanes before the middle: they give up
// width (never below SQUEEZED_MIN) so the middle keeps MIDDLE_MIN.
export const MIDDLE_MIN = 360;
export const SQUEEZED_MIN = 200;
const LANE_GAP = 16;

// `avail` is the layout's inner width in px (null when not measured yet);
// `left` and `right` are the chosen widths, 0 for an empty lane. The space
// left for the lanes is shared out evenly; a lane narrower than its share
// keeps its width and the rest goes to the other.
export function fitSideWidths(avail, left, right) {
  const asked = { left, right };
  if (!Number.isFinite(avail)) return asked;
  const sides = ["left", "right"].filter((s) => asked[s] > 0).sort((a, b) => asked[a] - asked[b]);
  let budget = avail - sides.length * LANE_GAP - MIDDLE_MIN;
  if (asked.left + asked.right <= budget) return asked;
  const out = { left: 0, right: 0 };
  sides.forEach((s, i) => {
    const give = Math.min(asked[s], Math.floor(budget / (sides.length - i)));
    out[s] = Math.min(asked[s], Math.max(SQUEEZED_MIN, give));
    budget -= give;
  });
  return out;
}

const emptyLanes = () => ({ left: [], right: [], top: [], bottom: [] });

export function allowedIn(def, lane) {
  const cls = def?.lanes;
  if (cls === "side") return lane === "left" || lane === "right";
  if (cls === "edge") return lane === "top" || lane === "bottom";
  return true;
}

export function kindOfTab(tabId, state) {
  const id = typeof tabId === "string" ? tabId : "";
  if (id === "home" || id === "graph" || id === "sources" || id === "quick-notes" || id === "extensions" || id === "chats") return id;
  if (id.startsWith("source:")) return "source";
  if (id.startsWith("node:")) {
    const node = state?.nodes?.[id.slice(5)];
    if (!state) return "page";
    return node?.type === "page" ? "page" : "container";
  }
  return "home";
}

const isSize = (s) => SIZES.includes(s);

function clampWidth(n) {
  return Math.min(LANE_WIDTH.max, Math.max(LANE_WIDTH.min, Math.round(n)));
}

export function kindLayout(layout, kind, defs) {
  const defaults = KIND_DEFAULTS[kind] || { lanes: emptyLanes(), size: {} };
  const saved = layout?.kinds?.[kind];
  const savedLanes = saved && typeof saved === "object" ? saved.lanes : null;
  const seen = new Set();
  const lanes = emptyLanes();
  for (const lane of LANES) {
    const raw = savedLanes && typeof savedLanes === "object" && lane in savedLanes ? savedLanes[lane] : defaults.lanes[lane];
    if (!Array.isArray(raw)) continue;
    for (const id of raw) {
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      lanes[lane].push(id);
    }
  }
  const savedSize = saved && typeof saved.size === "object" && saved.size ? saved.size : {};
  const size = {};
  for (const id of seen) {
    // A saved size, else the kind's default, else the widget's own default size.
    const own = savedSize[id];
    const s = isSize(own) ? own : defaults.size[id] ?? defs?.[id]?.size;
    size[id] = isSize(s) ? s : "m";
  }
  const savedWidths = saved && typeof saved.widths === "object" && saved.widths ? saved.widths : {};
  const widths = {};
  for (const lane of ["left", "right"]) {
    const w = savedWidths[lane];
    widths[lane] = typeof w === "number" && Number.isFinite(w) ? clampWidth(w) : LANE_WIDTH[lane];
  }
  return { lanes, size, widths };
}

const laneOf = (kl, id) => LANES.find((l) => kl.lanes[l].includes(id));

export function moveWidget(kl, id, lane, index, defs) {
  const from = laneOf(kl, id);
  if (!from || !LANES.includes(lane) || !allowedIn(defs?.[id], lane)) return kl;
  const lanes = { ...kl.lanes, [from]: kl.lanes[from].filter((x) => x !== id) };
  const target = from === lane ? lanes[lane] : kl.lanes[lane];
  const i = Math.max(0, Math.min(Number.isFinite(index) ? index : target.length, target.length));
  lanes[lane] = [...target.slice(0, i), id, ...target.slice(i)];
  return { ...kl, lanes };
}

export function setSize(kl, id, size) {
  if (!isSize(size) || !laneOf(kl, id)) return kl;
  return { ...kl, size: { ...kl.size, [id]: size } };
}

export function setLaneWidth(kl, lane, px) {
  if ((lane !== "left" && lane !== "right") || typeof px !== "number" || !Number.isFinite(px)) return kl;
  return { ...kl, widths: { ...kl.widths, [lane]: clampWidth(px) } };
}

export function addWidget(kl, id, lane, defs) {
  if (typeof id !== "string" || laneOf(kl, id)) return kl;
  const target = LANES.includes(lane) && allowedIn(defs?.[id], lane) ? lane : LANES.find((l) => allowedIn(defs?.[id], l));
  if (!target) return kl;
  return {
    ...kl,
    lanes: { ...kl.lanes, [target]: [...kl.lanes[target], id] },
    size: { ...kl.size, [id]: isSize(defs?.[id]?.size) ? defs[id].size : "m" },
  };
}

export function removeWidget(kl, id) {
  const from = laneOf(kl, id);
  if (!from) return kl;
  const size = { ...kl.size };
  delete size[id];
  return { ...kl, lanes: { ...kl.lanes, [from]: kl.lanes[from].filter((x) => x !== id) }, size };
}
