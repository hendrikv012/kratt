import { useLayoutEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { motionReduced } from "../../motion.js";
import useViewerKeys from "./useViewerKeys.js";
import "../artifacts.css";

const markdown = new MarkdownIt({ html: false, linkify: false });

// Plain text of rendered slide Markdown, for screen readers.
function plain(html) {
  return (new DOMParser().parseFromString(html, "text/html").body.textContent || "").trim();
}

// Slide-by-slide reader in a 16:9 frame. Click, Space, arrows and Page keys move.
export default function SlidesViewer({ items = [] }) {
  const rootRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState("slide");

  // The ancestor is only known once mounted.
  useLayoutEffect(() => {
    setMode(motionReduced(rootRef.current) ? "none" : "slide");
  }, []);

  const last = items.length - 1;
  const at = Math.min(idx, Math.max(0, last));
  const slide = items[at];
  const move = (d) => setIdx(() => Math.max(0, Math.min(last, at + d)));

  // Clicking the slide goes forward, unless it hit a link or button or ended a text selection.
  const onSlideClick = (e) => {
    if (e.target.closest?.("a, button")) return;
    if (window.getSelection?.()?.toString()) return;
    move(1);
  };

  useViewerKeys(rootRef, {
    ArrowRight: () => move(1),
    " ": () => move(1),
    PageDown: () => move(1),
    ArrowLeft: () => move(-1),
    PageUp: () => move(-1),
  });

  const body = useMemo(() => (slide ? markdown.render(slide.body || "") : ""), [slide]);

  const label = slide ? (slide.title || "").trim() || plain(body) : "";
  const statusText = slide ? `Slide ${at + 1} of ${items.length}: ${label}` : "";

  return (
    <div className="st-viewer st-slides" ref={rootRef} tabIndex={-1}>
      <div className="sr-only" aria-live="polite">{statusText}</div>
      {slide ? (
        <>
          <div className="st-slides-stage">
            <div
              className="st-slide"
              role="group"
              aria-roledescription="slide"
              tabIndex={0}
              aria-label={`Slide ${at + 1} of ${items.length}`}
              onClick={onSlideClick}
            >
              <div key={at} className="st-slide-inner" data-motion={mode}>
                {slide.title && <h2 className="st-slide-title">{slide.title}</h2>}
                <div className="st-slide-body" dangerouslySetInnerHTML={{ __html: body }} />
              </div>
            </div>
          </div>
          <div className="st-viewer-bar">
            <button type="button" className="st-ghost-button" aria-label="Previous slide" onClick={() => move(-1)} disabled={at === 0}>Previous</button>
            <span className="st-viewer-count">{at + 1} / {items.length}</span>
            <button type="button" className="st-ghost-button" aria-label="Next slide" onClick={() => move(1)} disabled={at >= last}>Next</button>
          </div>
        </>
      ) : (
        <p className="st-viewer-count">No slides.</p>
      )}
    </div>
  );
}
