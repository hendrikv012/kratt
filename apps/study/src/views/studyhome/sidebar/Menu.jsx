import { useEffect, useRef, useState } from "react";

// A small button that opens a menu below it. Clicking outside, pressing
// Escape or choosing an item closes it.
export default function Menu({ label, icon, items, className = "st-icon-button st-tree-action" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="st-menu-anchor" ref={ref}>
      <button
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {icon}
      </button>
      {open && (
        <div className="st-menu" role="menu">
          {items.map((item) =>
            item.custom ? (
              <div key={item.key}>{item.custom}</div>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                data-danger={item.danger || undefined}
                disabled={item.disabled || undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
                {item.hint && <kbd className="st-menu-hint">{item.hint}</kbd>}
              </button>
            )
          )}
        </div>
      )}
    </span>
  );
}
