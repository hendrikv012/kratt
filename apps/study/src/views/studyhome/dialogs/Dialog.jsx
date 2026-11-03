import { useEffect, useRef } from "react";
import "./dialogs.css";

// Small centred dialog over the app. Escape or a click outside cancels.
export default function Dialog({ title, onCancel, children, trapFocus = false }) {
  const ref = useRef(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.defaultPrevented || e.target?.closest?.('[role="menu"]')) return;
      if (e.key === "Escape") {
        e.preventDefault();
        cancel.current();
      } else if (trapFocus && e.key === "Tab") {
        const controls = [...ref.current.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
          .filter((el) => !el.disabled && !el.closest('[hidden]'));
        const at = controls.indexOf(document.activeElement);
        if (!controls.length) e.preventDefault();
        else if (e.shiftKey && at <= 0) { e.preventDefault(); controls.at(-1).focus(); }
        else if (!e.shiftKey && (at < 0 || at === controls.length - 1)) { e.preventDefault(); controls[0].focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (trapFocus && previous?.isConnected) previous.focus();
    };
  }, [trapFocus]);

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
