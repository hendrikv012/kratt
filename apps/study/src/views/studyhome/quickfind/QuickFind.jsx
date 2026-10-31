import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchItems } from "./search";
import "./quickfind.css";

// Ctrl+K box: type to find pages, subjects, folders and actions; Enter runs
// the highlighted one. `providers` are { id, items(ctx) => FindItem[] }.
function Box({ onClose, providers, recentIds }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const base = useId();
  const listRef = useRef(null);

  const all = useMemo(() => providers.flatMap((p) => p.items({ recentIds })), [providers, recentIds]);
  const groups = useMemo(() => searchItems(all, query, recentIds), [all, query, recentIds]);
  const flat = groups.flatMap((g) => g.items);
  const current = Math.min(active, flat.length - 1);
  const optionId = (i) => `${base}-${i}`;

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (item) => {
    onClose();
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setActive((current + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter" && flat[current]) {
      e.preventDefault();
      choose(flat[current]);
    }
  };

  let index = -1;
  return (
    <div className="st-find-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-find" role="dialog" aria-modal="true" aria-label="Quick find">
        <div className="st-find-field">
          <Search size={15} aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={`${base}-list`}
            aria-activedescendant={flat.length ? optionId(current) : undefined}
            aria-label="Search"
            placeholder="Search pages, subjects and actions"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="st-find-key">Esc</kbd>
        </div>

        <div className="st-find-results" ref={listRef}>
          {flat.length > 0 && (
            <div role="listbox" id={`${base}-list`} aria-label="Results">
              {groups.map((g) => (
                <div key={g.group} role="group" aria-label={g.group}>
                  <div className="st-find-group" aria-hidden="true">
                    {g.group}
                  </div>
                  {g.items.map((item) => {
                    const i = ++index;
                    return (
                      <div
                        key={item.id}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === current}
                        className="st-find-row"
                        data-active={i === current || undefined}
                        onPointerMove={() => i !== current && setActive(i)}
                        onClick={() => choose(item)}
                      >
                        {item.color && <span className="st-subject-mark" style={{ background: item.color }} aria-hidden="true" />}
                        <span className="st-find-title">{item.title}</span>
                        {item.subtitle && <span className="st-find-sub">{item.subtitle}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {!flat.length && (
            <p className="st-find-empty">{query.trim() ? "Nothing matches. Try another word." : "Type to search your notes."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuickFind({ open, onClose, providers, recentIds = [] }) {
  return open ? <Box onClose={onClose} providers={providers} recentIds={recentIds} /> : null;
}
