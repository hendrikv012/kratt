import { useEffect, useRef } from "react";
import "./artifacts.css";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Wraps a viewer. Closed, it just holds the children in place; open, the same element becomes a
// full-window overlay (position: fixed inside .study, which keeps the theme) with a slim bar on
// top, so the viewer is never remounted and keeps its place. It also asks the browser for full
// screen. Esc, the Exit button, or the browser leaving full screen closes it; focus goes in and
// comes back to where it was.
export default function FullMode({ open, title, onClose, children }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    ref.current?.focus();
    try {
      const asked = document.documentElement.requestFullscreen?.();
      asked?.catch?.(() => {}); // refused: the overlay still covers the window
    } catch {
      /* the overlay still covers the window */
    }
    const onKey = (e) => {
      if (e.key === "Escape") {
        // A menu or something else that used Esc keeps it.
        if (e.defaultPrevented || e.target?.closest?.("[role='menu']")) return;
        e.stopImmediatePropagation(); // other window Esc listeners (dialogs, panels) stay out of it
        close.current();
      } else if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled);
        const at = items.indexOf(document.activeElement);
        if (items.length === 0) e.preventDefault();
        else if (e.shiftKey && at <= 0) (e.preventDefault(), items[items.length - 1].focus());
        else if (!e.shiftKey && (at < 0 || at === items.length - 1)) (e.preventDefault(), items[0].focus());
      }
    };
    const onFullscreen = () => !document.fullscreenElement && close.current();
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen?.()?.catch?.(() => {});
        } catch {
          /* already out */
        }
      }
      if (before?.isConnected) before.focus();
    };
  }, [open]);

  const overlay = open ? { role: "dialog", "aria-modal": "true", "aria-label": title, tabIndex: -1 } : {};
  return (
    <div className={open ? "st-fullmode" : "st-fullmode-inline"} ref={ref} {...overlay}>
      {open && (
        <div className="st-fullmode-bar">
          <span className="st-fullmode-title">{title}</span>
          <button type="button" className="st-ghost-button" onClick={() => close.current()}>Exit full screen</button>
        </div>
      )}
      <div className="st-fullmode-body">{children}</div>
    </div>
  );
}
