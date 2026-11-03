import { FileText, File, Link, MoreHorizontal } from "lucide-react";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "../ui/context-menu";
import Menu from "../sidebar/Menu";
import { useStudy } from "../data/StudyProvider";
import { ago, titleOf } from "./SourcesView";
import { sourceKind, sourcePreview } from "./boxSummary";

export default function SourceCard({ source, style, onOpen, menuItems, dragProps }) {
  const { actions } = useStudy();
  const Icon = source.type === "link" ? Link : source.type === "file" ? File : FileText;
  const title = titleOf(source);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article className="st-src-box st-src-card" aria-label={title} {...dragProps}>
          <button className="st-src-card-open" onClick={onOpen} aria-label={`Open ${title}`}>
            <span className="st-src-box-title"><Icon size={18} aria-hidden="true" /><span>{title}</span></span>
            <span className="st-src-box-meta">{sourceKind(source)}</span>
            {style === "preview" && <span className="st-src-card-preview">{sourcePreview(source)}</span>}
            {style === "rich" && <span className="st-src-box-meta st-src-card-detail">
              {source.url || source.fileName || `${source.content?.length ?? 0} characters`}
              <span>Updated {ago(source.updatedAt)}</span>
            </span>}
          </button>
          <div className="st-src-card-actions">
            <label><input className="st-src-check" type="checkbox" checked={source.use}
              aria-label={`Use ${title}`} onChange={() => actions.setSourcesUse([source.id], !source.use)} /> Use source</label>
            <Menu label={`More for ${title}`} icon={<MoreHorizontal size={16} />} items={menuItems} />
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menuItems.map((item) => <ContextMenuItem key={item.label} onSelect={item.onSelect}
          data-danger={item.danger || undefined} className="data-[danger]:text-st-destructive">{item.label}</ContextMenuItem>)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
