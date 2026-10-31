import { Component, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "../ui/dropdown-menu";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuLabel, ContextMenuSeparator, ContextMenuRadioGroup, ContextMenuRadioItem,
} from "../ui/context-menu";
import { LANES, SIZES } from "../edges/lanes";
import { allowedIn, widgetDef } from "./registry";
import "./builtin";
import "./widgets.css";

const LANE_NAMES = { left: "Left edge", right: "Right edge", top: "Top edge", bottom: "Bottom edge" };
const SIZE_NAMES = { s: "Small", m: "Medium", l: "Large" };

const DROPDOWN = { Item: DropdownMenuItem, Label: DropdownMenuLabel, Separator: DropdownMenuSeparator, Group: DropdownMenuRadioGroup, Radio: DropdownMenuRadioItem };
const CONTEXT = { Item: ContextMenuItem, Label: ContextMenuLabel, Separator: ContextMenuSeparator, Group: ContextMenuRadioGroup, Radio: ContextMenuRadioItem };

// The same entries in the chevron menu and the right-click menu.
function MenuEntries({ P, def, lane, size, onMenu }) {
  const lanes = LANES.filter((l) => l !== lane && allowedIn(def, l));
  return (
    <>
      {lanes.length > 0 && (
        <>
          <P.Label>Move to</P.Label>
          {lanes.map((l) => (
            <P.Item key={l} onSelect={() => onMenu({ type: "move", lane: l })}>{LANE_NAMES[l]}</P.Item>
          ))}
          <P.Separator />
        </>
      )}
      <P.Label>Size</P.Label>
      <P.Group value={size} onValueChange={(s) => onMenu({ type: "size", size: s })}>
        {SIZES.map((s) => (
          <P.Radio key={s} value={s}>{SIZE_NAMES[s]}</P.Radio>
        ))}
      </P.Group>
      <P.Separator />
      <P.Item onSelect={() => onMenu({ type: "remove" })}>Remove</P.Item>
    </>
  );
}

// A widget that throws must not take the lane, or the screen, with it.
class Contained extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <p className="st-widget-empty">This widget stopped working</p>;
    return this.props.children;
  }
}

function Body({ def, size, context }) {
  if (def.missing) return <p className="st-widget-empty">{def.body}</p>;
  const Content = def.Component;
  return <Content compact={size === "s"} {...context} />;
}

// One widget in a lane. The header (the whole card when `bare`) is the drag
// handle; the chevron, a right-click and Enter on the header open the menu.
// Without `onMenu` (a Home tile) it is just the card: no handle, no menu.
export default function WidgetFrame({ id, lane, size, onMenu, handleProps, context }) {
  const def = widgetDef(id);
  const [open, setOpen] = useState(false);
  const Icon = def.icon;
  const entries = { def, lane, size, onMenu };
  // The layout's own keys (arrows) run first; Enter opens the menu.
  const onKeyDown = (e) => {
    handleProps?.onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      setOpen(true);
    }
  };
  const chevron = (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="st-wf-chevron" aria-label="Widget options">
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <MenuEntries P={DROPDOWN} {...entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const body = (
    <div className="st-wf-body">
      <Contained resetKey={id}>
        <Body def={def} size={size} context={context} />
      </Contained>
    </div>
  );

  if (!onMenu) {
    return def.bare ? (
      <div className="st-wf" role="region" aria-label={def.title} data-bare="true" data-size={size}>
        {body}
      </div>
    ) : (
      <section className="st-wf st-widget" aria-label={def.title} data-size={size}>
        <h2 className="st-widget-title">
          {Icon && <Icon size={13} aria-hidden="true" />}
          {def.title}
        </h2>
        {body}
      </section>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {def.bare ? (
          <div className="st-wf" role="region" aria-label={def.title} data-bare="true" data-lane={lane} data-size={size} tabIndex={0} {...handleProps} onKeyDown={onKeyDown}>
            {body}
            {chevron}
          </div>
        ) : (
          <section className="st-wf st-widget" aria-label={def.title} data-lane={lane} data-size={size}>
            <div className="st-wf-head" tabIndex={0} {...handleProps} onKeyDown={onKeyDown}>
              <h2 className="st-widget-title">
                {Icon && <Icon size={13} aria-hidden="true" />}
                {def.title}
              </h2>
              {chevron}
            </div>
            {body}
          </section>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries P={CONTEXT} {...entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
