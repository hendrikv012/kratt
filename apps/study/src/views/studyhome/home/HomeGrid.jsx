import { useWidgetDefs } from "../widgets/registry";
import WidgetFrame from "../widgets/WidgetFrame";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu";
import { homeLayout, spanOf } from "./grid";
import "./home.css";

// Home: the widgets as tiles on the snap grid, in their saved order. Nothing
// here edits them; a right-click anywhere offers the editor in Settings.
export default function HomeGrid({ layout, context, onEditHome }) {
  const defs = useWidgetDefs();
  const { order, size } = homeLayout(layout.home, defs);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="st-home-grid">
          {order.map((id) => {
            const { w, h } = spanOf(size[id]);
            return (
              <section key={id} className="st-home-tile" data-tile={id} style={{ "--w": w, "--h": h }}>
                <WidgetFrame id={id} size={size[id]} context={{ ...context, size: size[id] }} />
              </section>
            );
          })}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onEditHome}>Edit home screen…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
