import { MoreHorizontal, Trash2 } from "lucide-react";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "../ui/context-menu";
import Menu from "../sidebar/Menu";
import { TYPE_NAMES, titleOf, ago } from "./SourcesView";
import { useStudy } from "../data/StudyProvider";

// One source's row in a group: use tick, type, title, dates, delete and a ⋯
// menu (also on right-click). A source in two subjects has a row in each, told apart by `groupId`.

export default function SourceRow({ source, groupId, selected, onHover, onOpen, onDelete, menuItems = [], dragProps }) {
  const { actions } = useStudy();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <tr
      data-group={groupId}
      data-selected={selected || undefined}
      onMouseEnter={onHover}
      onClick={onOpen}
      {...dragProps}
    >
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="st-src-check"
          checked={source.use}
          onChange={() => actions.setSourcesUse([source.id], !source.use)}
          aria-label={`Use ${titleOf(source)}`}
        />
      </td>
      <td>
        <span className="st-src-type">
          <span className="st-src-dot" data-type={source.type} aria-hidden="true" />
          {TYPE_NAMES[source.type]}
        </span>
      </td>
      <td>
        <span className="st-src-title">{titleOf(source)}</span>
        {source.url && <span className="st-src-url">{source.url}</span>}
      </td>
      <td className="st-src-muted st-src-hide-sm">{ago(source.createdAt)}</td>
      <td className="st-src-muted st-src-hide-sm">{ago(source.updatedAt)}</td>
      <td className="st-src-right" onClick={(e) => e.stopPropagation()}>
        <button
          className="st-icon-button st-src-delete"
          aria-label={`Delete ${titleOf(source)}`}
          onClick={() => onDelete(source)}
        >
          <Trash2 size={15} />
        </button>
        <Menu label={`More for ${titleOf(source)}`} icon={<MoreHorizontal size={15} />} items={menuItems} />
      </td>
    </tr>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menuItems.map((item) => (
          <ContextMenuItem
            key={item.label}
            onSelect={item.onSelect}
            data-danger={item.danger || undefined}
            className="data-[danger]:text-st-destructive"
          >
            {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
