import "./kratt.css";

// Kratt, the mascot: a pixel sprite coloured by --st-kratt. The paths match
// public/kratt.svg. mode: idle | think | hop | sleep.
export default function Kratt({ size = 20, mode = "idle", label }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" };
  return (
    <svg
      className="st-kratt"
      data-mode={mode}
      width={size}
      height={Math.round((size * 58) / 72)}
      viewBox="-3 -6 72 58"
      shapeRendering="crispEdges"
      {...a11y}
    >
      <g className="k-hop">
        <rect className="k-tl" x="18" y="6" width="4" height="14" />
        <rect className="k-tr" x="42" y="10" width="4" height="10" />
        <path className="k-body" d="M12 18h40v18h-40z M22 26v8h6v-8z M36 26v8h6v-8z M12 38h40v4h-40z M6 30h8v4h-8z M6 30h4v14h-4z M4 42h8v8h-8z M20 40h4v10h-4z M40 40h4v10h-4z" />
        <path className="k-fork" d="M50 30h10v4h-10z M56 0h4v34h-4z M50 8h16v4h-16z M50 0h4v10h-4z M62 0h4v10h-4z" />
        <g className="k-lids">
          <rect x="22" y="26" width="6" height="8" />
          <rect x="36" y="26" width="6" height="8" />
        </g>
        <g className="k-z">
          <path d="M58 -6h6v2h-2v2h-2v2h4v2h-6v-2h2v-2h2v-2h-4z" />
        </g>
      </g>
    </svg>
  );
}
