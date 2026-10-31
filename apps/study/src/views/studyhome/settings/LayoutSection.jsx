import { LayoutDashboard, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useShell } from "../ShellContext";
import { EXTENSION_EMPTY, groupBySource, useWidgetDefs } from "../widgets/registry";
import { Group, Row, Section, Segmented, Toggle } from "./controls";
import HomeGridEditor from "./HomeGridEditor";

const BOX = "divide-y divide-st-border rounded-st border border-st-border";

function WidgetList({ items, defs, api, empty }) {
  if (!items.length) return <p className="text-sm text-st-muted-foreground">{empty}</p>;
  return (
    <div className={BOX}>
      {items.map((w) => {
        const name = defs[w.id]?.title ?? w.id;
        return (
          <label key={w.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1">{name}</span>
            <Switch
              checked={w.on}
              aria-label={`${w.on ? "Remove" : "Add"} ${name} on Home`}
              onCheckedChange={(on) => api.setHomeWidget(w.id, on)}
            />
          </label>
        );
      })}
    </div>
  );
}

// The layout controls work through `shell.layoutApi` (filled by StudyPreview).
export default function LayoutSection({ value, set, settings, setGroup }) {
  const { layoutApi: api } = useShell();
  const defs = useWidgetDefs();
  const clock = settings.home.clock;
  const setClock = (patch) => setGroup("home", { clock: { ...clock, ...patch } });
  const list = api.homeWidgets();
  const on = new Map(list.map((w) => [w.id, w.on]));
  const [builtin, fromExtensions] = groupBySource(list.map((w) => w.id)).map((g) => g.items.map((id) => ({ id, on: on.get(id) })));
  const sidebar = settings.layout.sidebar;
  const setSidebar = (patch) => setGroup("layout", { sidebar: { ...sidebar, ...patch } });
  const head = "mb-2 mt-5 text-xs font-medium text-st-muted-foreground";

  return (
    <Section title="Layout and home screen" description="Hover anything on screen to see its handle, or arrange everything at once.">
      <div className={BOX}>
        <Row label="Edit layout" description="Move and resize widgets on page and graph screens.">
          <Button size="sm" onClick={() => api.editLayout()}>
            <LayoutDashboard />
            Edit layout
          </Button>
        </Row>
        <Row label="Reset to default" description="Put every screen, the sidebar and the tabs back the way they started. You can undo it.">
          <Button variant="ghost" size="sm" className="border border-st-border" onClick={() => api.resetAll()}>
            <RotateCcw />
            Reset to default
          </Button>
        </Row>
        <Row label="Tab bar" description="Near the edge, the bar slides in over the page when you move to it.">
          <Segmented
            size="sm"
            label="Tab bar"
            value={value.tabBar}
            onChange={(tabBar) => set({ tabBar })}
            options={[
              { value: "always", label: "Always shown" },
              { value: "auto", label: "Show near the edge" },
            ]}
          />
        </Row>
        <Row label="Hide while working" description="Typing or scrolling in the page tucks the tab bar away. Move to the edge to get it back.">
          <Toggle label="Hide the tab bar while working" checked={value.tabBarHideWhileWorking} onChange={(tabBarHideWhileWorking) => set({ tabBarHideWhileWorking })} />
        </Row>
        <Row label="Clock in the tab bar" description="The time in the middle of the tab bar, in the clock's hours below.">
          <Toggle label="Clock in the tab bar" checked={value.tabBarClock} onChange={(tabBarClock) => set({ tabBarClock })} />
        </Row>
        <Row label="Sidebar" description="Hidden slides in when you move to its edge. Ctrl+\ switches anytime.">
          <Segmented
            size="sm"
            label="Sidebar"
            value={value.sidebar}
            onChange={(sidebar) => set({ sidebar })}
            options={[
              { value: "pinned", label: "Always shown" },
              { value: "hidden", label: "Hidden" },
            ]}
          />
        </Row>
      </div>

      <div className="mt-6" />
      <Group title="Home screen">
        <HomeGridEditor />
        <h3 className={head}>On Home</h3>
        <p className="text-xs text-st-muted-foreground">Turn widgets on or off. New ones go where there's room; move them after.</p>
        <h3 className={head}>Built in</h3>
        <WidgetList items={builtin} defs={defs} api={api} empty="" />
        <h3 className={head}>From extensions</h3>
        <WidgetList items={fromExtensions} defs={defs} api={api} empty={EXTENSION_EMPTY} />
        <h3 className={head}>Clock</h3>
        <Row label="Style">
          <Segmented
            size="sm"
            label="Clock style"
            value={clock.style}
            onChange={(style) => setClock({ style })}
            options={[
              { value: "digital", label: "Digital" },
              { value: "analog", label: "Analog" },
            ]}
          />
        </Row>
        <Row label="Hours">
          <Segmented
            size="sm"
            label="Clock hours"
            value={clock.hours}
            onChange={(hours) => setClock({ hours })}
            options={[
              { value: "24", label: "24-hour" },
              { value: "12", label: "12-hour" },
            ]}
          />
        </Row>
        <Row label="Show seconds">
          <Toggle label="Show seconds" checked={clock.seconds} onChange={(seconds) => setClock({ seconds })} />
        </Row>
        <Row label="Show date">
          <Toggle label="Show date" checked={clock.date} onChange={(date) => setClock({ date })} />
        </Row>
      </Group>

      <Group title="Sidebar">
        <Row label="Chats">
          <Toggle label="Chats" checked={sidebar.chats} onChange={(chats) => setSidebar({ chats })} />
        </Row>
        <Row label="Due for review">
          <Toggle label="Due for review" checked={sidebar.review} onChange={(review) => setSidebar({ review })} />
        </Row>
        <Row label="Pinned">
          <Toggle label="Pinned" checked={sidebar.pinned} onChange={(pinned) => setSidebar({ pinned })} />
        </Row>
      </Group>
    </Section>
  );
}
