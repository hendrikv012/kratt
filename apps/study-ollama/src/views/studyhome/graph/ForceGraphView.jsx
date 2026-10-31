import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import * as d3 from "d3-force";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { lokusGraph, lokusLocalGraph } from "../data/graphData";
import { motionReduced } from "../motion";
import { tripletHex } from "../theme/themes";
import "./graph.css";

// The graph, drawn the way Lokus's graph view draws a vault
// (views/ProfessionalGraphView.jsx): the same colors, dot sizes, labels,
// links, arrows, forces and Graph Settings. Study additions: the "How well
// you know it" color scheme, quick notes as loose gray dots, clicking opens
// the item, and the graph sizes itself to its box and fits once settled.

// Lokus's color schemes.
const COLOR_SCHEMES = {
  type: { document: "#10b981", placeholder: "#6b7280", tag: "#ef4444", folder: "#f59e0b", attachment: "#8b5cf6" },
  folder: { default: "#6366f1", depth1: "#10b981", depth2: "#f59e0b", depth3: "#ef4444", depth4: "#8b5cf6", depth5: "#06b6d4" },
  tag: { research: "#10b981", project: "#f59e0b", idea: "#8b5cf6", note: "#6366f1", todo: "#ef4444", archive: "#6b7280" },
  date: { recent: "#10b981", week: "#f59e0b", month: "#6366f1", old: "#6b7280" },
};
const SELECTED_COLOR = "#ff6b6b";
const KNOWN_COLOR = COLOR_SCHEMES.type.document;

export const MASTERY_SCHEME = {
  value: "mastery",
  label: "How well you know it",
  description: "One color. The better you know a page, the brighter its dot. Notes are gray.",
};

// How bright a dot is under "How well you know it": even an unstudied
// page stays visible.
const brightness = (mastery) => (mastery === null ? 0.28 : 0.28 + 0.72 * mastery);

const idOf = (end) => end?.id ?? end;
const NO_DOTS = { nodes: [], links: [] };
const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };
const FIT_MARGIN = 24;

// Lokus's filters (search, tags, attachments, unresolved, orphans).
function filterGraphData(data, config) {
  let nodes = [...data.nodes];
  let links = [...data.links];
  const search = config.search?.trim().toLowerCase();
  if (search) {
    nodes = nodes.filter(
      (n) => n.title?.toLowerCase().includes(search) || n.label?.toLowerCase().includes(search) || n.type?.toLowerCase().includes(search)
    );
  }
  if (!config.showTags) nodes = nodes.filter((n) => n.type !== "tag");
  if (!config.showAttachments) nodes = nodes.filter((n) => n.type !== "attachment");
  if (config.hideUnresolved) nodes = nodes.filter((n) => n.type !== "placeholder" && !n.isPlaceholder);
  if (!config.showOrphans) {
    const ids = new Set(nodes.map((n) => n.id));
    const connected = new Set();
    links.forEach((l) => {
      if (ids.has(idOf(l.source))) connected.add(idOf(l.source));
      if (ids.has(idOf(l.target))) connected.add(idOf(l.target));
    });
    nodes = nodes.filter((n) => connected.has(n.id));
  }
  const valid = new Set(nodes.map((n) => n.id));
  links = links.filter((l) => valid.has(idOf(l.source)) && valid.has(idOf(l.target)));
  return { nodes, links };
}

// The theme's graph colors (Settings > Appearance > Graph dots), from the
// variables the theme sets on the page root, as #rrggbb so the drawing code
// can add alpha. Read again whenever the theme changes them. Missing ones
// fall back to Lokus's own colors.
function readGraphTheme() {
  const root = document.documentElement;
  const computed = window.getComputedStyle(root);
  const read = (name) => root.style.getPropertyValue(name) || computed.getPropertyValue(name);
  const hex = (name) => tripletHex(read(name));
  const alpha = parseFloat(read("--st-c-graph-link-alpha"));
  return {
    node: hex("--st-c-graph-node"),
    link: hex("--st-c-graph-link"),
    label: hex("--st-c-graph-label"),
    linkAlpha: Number.isFinite(alpha) ? alpha : 0.25,
  };
}

function useGraphTheme() {
  const [theme, setTheme] = useState(readGraphTheme);
  useEffect(() => {
    const update = () =>
      setTheme((cur) => {
        const next = readGraphTheme();
        return Object.keys(next).every((k) => next[k] === cur[k]) ? cur : next;
      });
    update(); // the theme may have been applied after the first render
    if (typeof MutationObserver === "undefined") return undefined;
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

const alphaHex = (a) => Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");

function useElementSize() {
  const [element, setElement] = useState(null);
  const [size, setSize] = useState({ width: 600, height: 400 });
  useEffect(() => {
    if (!element) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    ro.observe(element);
    return () => ro.disconnect();
  }, [element]);
  return [setElement, size, element];
}

// variant: "home", "full" (the Graph tab) or "local" (one page and what it
// connects to). `settings` is the Graph Settings config (Lokus's shape).
// `fitPadding` keeps the dots clear of the widget lanes on Home: one number
// for both sides, or the lane boxes { left, right, top, bottom } in px.
// The Graph tab passes selection and hover state in, so its Graph Settings
// panel can show them, and gets `apiRef.current.focusNode(id)`.
export default function ForceGraphView({
  variant = "full",
  focusId = null,
  settings: config,
  fitPadding = 60,
  reduceMotion = false,
  selectedNodes: selectedProp,
  onSelectedNodes,
  onHoveredNode,
  apiRef,
}) {
  const { state, parents } = useStudy();
  const { open } = useShell();
  const theme = useGraphTheme();
  const graphRef = useRef(null);
  const [containerRef, size, containerEl] = useElementSize();
  // Either Reduce motion (the app's setting or the computer's) makes every
  // move of the view instant.
  const glide = (ms) => (reduceMotion || motionReduced(containerEl) ? 0 : ms);
  const [ownSelected, setOwnSelected] = useState([]);
  const [hoveredNode, setHoveredNode] = useState(null);
  // Dots are handed to the graph only once Lokus's forces are set, so the
  // first layout already uses them. Then fit: at once, and again when settled.
  const [forcesReady, setForcesReady] = useState(false);
  const fits = useRef(0);
  const selectedNodes = selectedProp ?? ownSelected;
  const setSelectedNodes = onSelectedNodes ?? setOwnSelected;

  const graphData = useMemo(
    () => (variant === "local" ? lokusLocalGraph(state, parents, focusId) : lokusGraph(state, parents)),
    [state, parents, variant, focusId]
  );
  const filtered = useMemo(() => filterGraphData(graphData, config), [graphData, config]);

  // Lokus's forces, from Graph Settings.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg?.d3Force) {
      setForcesReady(true);
      return;
    }
    fg.d3Force("charge", d3.forceManyBody().strength(-config.repelStrength * 10));
    const linkForce = fg.d3Force("link");
    if (linkForce) {
      linkForce.distance(config.linkDistance);
      linkForce.strength(config.linkStrength);
    }
    fg.d3Force("center", d3.forceCenter(0, 0).strength(config.centerStrength));
    fg.d3Force("collision", d3.forceCollide(12 * 1.5));
    if (forcesReady) fg.d3ReheatSimulation?.();
    else setForcesReady(true);
  }, [config.repelStrength, config.linkDistance, config.linkStrength, config.centerStrength, filtered]);

  // Fit every dot in. On Home the sides keep clear of the widget columns,
  // so the graph fills the space between them, top to bottom.
  const fit = (ms) => {
    const fg = graphRef.current;
    if (!fg) return;
    if (variant !== "home") {
      fg.zoomToFit?.(ms, variant === "local" ? 30 : 60);
      return;
    }
    const box = fg.getGraphBbox?.();
    if (!box) return;
    // The lane boxes (or one padding for both sides) plus a margin; lanes
    // that leave too little room are ignored on that axis.
    const ins = typeof fitPadding === "number" ? { left: fitPadding, right: fitPadding, top: 40, bottom: 40 } : { ...NO_INSETS, ...fitPadding };
    const roomFor = (a, b, total) => total - a - b - 2 * FIT_MARGIN > 200;
    const [l, r] = roomFor(ins.left, ins.right, size.width) ? [ins.left, ins.right] : [0, 0];
    const [t, b] = roomFor(ins.top, ins.bottom, size.height) ? [ins.top, ins.bottom] : [0, 0];
    const width = Math.max(1, box.x[1] - box.x[0]);
    const height = Math.max(1, box.y[1] - box.y[0]);
    const zoom = Math.max(0.05, Math.min((size.width - l - r - 2 * FIT_MARGIN) / width, (size.height - t - b - 2 * FIT_MARGIN) / height, 4));
    // Centre the dots in the free middle, not the whole canvas.
    fg.centerAt((box.x[0] + box.x[1]) / 2 - (l - r) / 2 / zoom, (box.y[0] + box.y[1]) / 2 - (t - b) / 2 / zoom, ms);
    fg.zoom(zoom, ms);
  };

  // When the lanes or the graph's own box change size, the graph re-fits
  // (the first fit can land before the box has its real size).
  const insetKey = JSON.stringify(fitPadding);
  useEffect(() => {
    if (fits.current > 0) fit(glide(300));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insetKey, size.width, size.height]);

  if (apiRef) {
    apiRef.current = {
      focusNode: (id) => {
        const node = filtered.nodes.find((n) => n.id === id);
        if (!node || !graphRef.current) return;
        setSelectedNodes([node.id]);
        graphRef.current.centerAt(node.x, node.y, glide(1000));
        graphRef.current.zoom(1.8, glide(1000));
      },
    };
  }

  const scheme = config.colorScheme || "type";
  const groups = config.colorGroups || [];

  const getNodeColor = (node) => {
    if (selectedNodes.includes(node.id)) return SELECTED_COLOR;
    switch (scheme) {
      case "mastery":
        return node.type === "placeholder" ? COLOR_SCHEMES.type.placeholder : theme.node ?? KNOWN_COLOR;
      case "folder": {
        const depth = node.metadata?.path ? node.metadata.path.split("/").length - 1 : 0;
        return node.metadata?.path ? COLOR_SCHEMES.folder[`depth${Math.min(depth, 5)}`] || COLOR_SCHEMES.folder.default : COLOR_SCHEMES.folder.default;
      }
      case "tag": {
        const tag = node.metadata?.tags?.[0]?.toLowerCase();
        const match = tag && Object.entries(COLOR_SCHEMES.tag).find(([category]) => tag.includes(category));
        return match ? match[1] : COLOR_SCHEMES.tag.note;
      }
      case "creation-date":
      case "modification-date": {
        const when = scheme === "creation-date" ? node.metadata?.created : node.metadata?.modified ?? node.metadata?.created;
        if (!when) return COLOR_SCHEMES.date.old;
        const days = (Date.now() - when) / (1000 * 60 * 60 * 24);
        if (days < 7) return COLOR_SCHEMES.date.recent;
        if (days < 30) return COLOR_SCHEMES.date.week;
        if (days < 90) return COLOR_SCHEMES.date.month;
        return COLOR_SCHEMES.date.old;
      }
      case "custom":
        return groups.find((g) => g.nodeIds?.includes(node.id))?.color || "#6366f1";
      default:
        return COLOR_SCHEMES.type[node.type] || "#6366f1";
    }
  };

  const getNodeSize = (node) => {
    let size = node.size || 8;
    if (node.backlinkCount) size += Math.min(5, node.backlinkCount * 0.5);
    if (selectedNodes.includes(node.id)) size *= 1.5;
    return size * (config.nodeSizeMultiplier || 1);
  };

  const linkTouchesSelection = (link) => selectedNodes.includes(idOf(link.source)) || selectedNodes.includes(idOf(link.target));
  const getLinkColor = (link) => (linkTouchesSelection(link) ? "#ff6b6b80" : link.color || (theme.link ? theme.link + alphaHex(theme.linkAlpha) : "#ffffff40"));
  const getLinkWidth = (link) => (link.width || 1.5) * (linkTouchesSelection(link) ? 2 : 1) * (config.lineSizeMultiplier || 1);

  const renderNode2D = (node, ctx) => {
    // The library paints once before the simulation has placed anything.
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const size = getNodeSize(node);
    const color = getNodeColor(node);
    const selected = selectedNodes.includes(node.id);
    const hovered = hoveredNode?.id === node.id;
    const search = config.search?.trim().toLowerCase();
    const isSearchMatch =
      search && (node.title?.toLowerCase().includes(search) || node.label?.toLowerCase().includes(search) || node.type?.toLowerCase().includes(search));

    // Search matches pulse.
    if (isSearchMatch) {
      const pulse = 0.5 + 0.5 * Math.sin(((Date.now() % 1500) / 1500) * Math.PI * 2);
      ctx.beginPath();
      ctx.arc(node.x, node.y, size * (2.5 + pulse), 0, 2 * Math.PI, false);
      ctx.fillStyle = `rgba(124, 58, 237, ${0.3 * pulse})`;
      ctx.fill();
    }

    if (selected || hovered) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, size * 2.5, 0, 2 * Math.PI, false);
      ctx.fillStyle = color + "30";
      ctx.fill();
    }

    const known = scheme === "mastery" && node.type !== "placeholder" && !selected ? brightness(node.mastery) : 1;
    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
    ctx.globalAlpha = (search && !isSearchMatch ? 0.3 : 1) * known;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (selected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
      ctx.strokeStyle = theme.label ?? "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Labels fade in with dot size, like Obsidian.
    const threshold = 10 * (config.textFadeMultiplier || 1.3);
    if (size > threshold || selected || hovered) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const opacity = selected || hovered ? 1 : Math.min(1, size / threshold);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = theme.label ?? "#ffffff";
      ctx.font = `${Math.max(10, size / 2)}px Arial`;
      ctx.fillText(node.label || node.title || node.id, node.x, node.y + size + 15);
      ctx.globalAlpha = 1;
    }
  };

  return (
    <div
      className="st-fgraph"
      data-variant={variant}
      ref={containerRef}
    >
      <ForceGraph2D
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={forcesReady ? filtered : NO_DOTS}
        nodeColor={getNodeColor}
        nodeVal={getNodeSize}
        nodeLabel={(node) => `${node.label || node.title || node.id}\nType: ${node.type}\nBacklinks: ${node.backlinkCount || 0}`}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        linkDirectionalArrowLength={config.showArrow ? 6 : 0}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={getLinkColor}
        onNodeHover={(node) => {
          setHoveredNode(node);
          onHoveredNode?.(node);
        }}
        onNodeClick={(node, event) => {
          if (selectedNodes.includes(node.id)) setSelectedNodes(selectedNodes.filter((id) => id !== node.id));
          else setSelectedNodes(event?.ctrlKey || event?.metaKey ? [...selectedNodes, node.id] : [node.id]);
          open(node.kind === "note" ? { view: "quick-notes" } : { view: "node", id: node.id });
        }}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.3}
        cooldownTicks={300}
        warmupTicks={100}
        onEngineTick={() => {
          if (fits.current > 0 || !forcesReady) return;
          fits.current = 1;
          fit(0);
        }}
        onEngineStop={() => {
          if (fits.current > 1 || !forcesReady) return;
          fits.current = 2;
          fit(glide(500));
        }}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
        backgroundColor="transparent"
        nodeCanvasObject={renderNode2D}
      />
      {graphData.nodes.length === 0 && variant === "local" && <p className="st-fgraph-empty">No connections yet.</p>}
    </div>
  );
}
