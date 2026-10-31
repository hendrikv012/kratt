import { useLayoutEffect, useRef, useState } from "react";
import { Bell, Blocks, BookOpen, Database, Info, Keyboard, LayoutDashboard, Palette, Sparkles } from "lucide-react";
import "./settings.css";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import Toasts from "../Toasts";
import AppearanceSection from "./AppearanceSection";
import LayoutSection from "./LayoutSection";
import ExtensionsSection from "./ExtensionsSection";
import { AiSection, StudyingSection } from "./LearningSections";
import { AboutSection, DataSection, NotificationsSection, ShortcutsSection } from "./SystemSections";

// Every section gets the same props: `value` and `set` for its own settings
// group (`group`), plus `reset` for starting over. Sections without a group
// just ignore them.
export const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette, group: "appearance", Component: AppearanceSection },
  { id: "layout", label: "Layout and home screen", icon: LayoutDashboard, group: "appearance", Component: LayoutSection },
  { id: "studying", label: "Studying", icon: BookOpen, group: "studying", Component: StudyingSection },
  { id: "ai", label: "AI", icon: Sparkles, group: "ai", Component: AiSection },
  { id: "notifications", label: "Notifications", icon: Bell, group: "notifications", Component: NotificationsSection },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard, Component: ShortcutsSection },
  { id: "data", label: "Data", icon: Database, group: "data", Component: DataSection },
  { id: "extensions", label: "Extensions", icon: Blocks, Component: ExtensionsSection },
  { id: "about", label: "About", icon: Info, Component: AboutSection },
];

const NAV_ROW =
  "flex min-h-8 w-full items-start gap-2 rounded-st-sm px-2 py-1.5 text-left text-sm text-st-sidebar-foreground hover:bg-st-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring aria-[current=page]:bg-st-sidebar-accent aria-[current=page]:text-st-foreground";

// `toasts` are the app's toasts. While Settings is open they are drawn inside
// it, where its focus trap lets the keyboard and screen readers reach them.
export default function SettingsDialog({ section, onSection, onClose, settings, set, reset, toasts = [] }) {
  const { group, Component } = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  // The dialog opens inside the study root, so it sees the study's variables.
  const anchor = useRef(null);
  const [container, setContainer] = useState(null);
  useLayoutEffect(() => setContainer(anchor.current?.closest(".study") ?? document.body), []);

  return (
    <>
      <span ref={anchor} hidden />
      {container && (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
          <DialogContent
            container={container}
            aria-describedby={undefined}
            className="z-50 flex h-[min(40rem,calc(100vh-3rem))] w-[calc(100%-2rem)] max-w-[54rem] gap-0 overflow-hidden p-0"
          >
            <nav className="flex w-56 shrink-0 flex-col gap-px overflow-y-auto border-r border-st-sidebar-border bg-st-sidebar p-2" aria-label="Settings sections">
              <DialogTitle className="px-2 pb-1.5 pt-1 text-xs font-medium leading-normal tracking-normal text-st-sidebar-foreground/70">Settings</DialogTitle>
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className={NAV_ROW} aria-current={section === id ? "page" : undefined} onClick={() => onSection(id)}>
                  <Icon size={15} className="mt-px shrink-0" aria-hidden="true" />
                  <span className="min-w-0 leading-tight">{label}</span>
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto p-6 pr-14">
              <Component value={group && settings[group]} set={(patch) => set(group, patch)} reset={reset} settings={settings} setGroup={set} />
            </div>
            <Toasts items={toasts} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
