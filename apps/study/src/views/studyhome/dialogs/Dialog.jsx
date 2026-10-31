import { useEffect, useRef } from "react";
import "./dialogs.css";

// Small centred dialog over the app. Escape or a click outside cancels.
export default function Dialog({ title, onCancel, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="st-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="st-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <h2 className="st-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// One choice in a dialog: a title, what it does, and a button-like row.
export function Choice({ title, description, danger = false, onClick }) {
  return (
    <button className="st-choice" data-danger={danger || undefined} onClick={onClick}>
      <span className="st-choice-title">{title}</span>
      {description && <span className="st-choice-desc">{description}</span>}
    </button>
  );
}
