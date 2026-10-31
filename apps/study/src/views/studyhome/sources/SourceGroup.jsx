import { ChevronDown, ChevronRight } from "lucide-react";

// One subject's section of the Sources list: a collapsible header (colour dot,
// name and count) over a table of its rows. `dropProps` and `over` are the
// drop target hooks the list drives while a source is dragged.

export function Cols() {
  return (
    <colgroup>
      <col className="st-src-col-use" />
      <col className="st-src-col-type" />
      <col />
      <col className="st-src-col-date" />
      <col className="st-src-col-date" />
      <col className="st-src-col-actions" />
    </colgroup>
  );
}

export default function SourceGroup({ group, collapsed, onToggle, children, dropProps, over }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const empty = group.sources.length === 0;
  return (
    <section className="st-src-group" aria-label={group.name} data-over={over || undefined} {...dropProps}>
      <button className="st-src-group-head" aria-expanded={!collapsed} onClick={onToggle}>
        <Chevron size={14} aria-hidden="true" />
        {group.color && <span className="st-src-group-dot" style={{ background: group.color }} aria-hidden="true" />}
        <span>{`${group.name} · ${group.sources.length}`}</span>
      </button>
      {!collapsed &&
        (empty ? (
          <p className="st-src-group-empty">Drag sources here</p>
        ) : (
          <table className="st-src-table">
            <Cols />
            <tbody>{children}</tbody>
          </table>
        ))}
    </section>
  );
}
