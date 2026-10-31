import { useRef } from "react";
import { PRESETS, isDark, resolveTheme, themeVars } from "../theme/themes";
import { KRATT_STYLES, styleOf, themeIdFor } from "../theme/styles";
import { useExtensionThemes } from "../extensions/useContributions";
import { useShell } from "../ShellContext";
import { Group, Row, Section, Segmented, Toggle } from "./controls";
import Kratt from "../kratt/Kratt";
import ThemeCards from "./appearance/ThemeCards";
import ThemeEditor from "./appearance/ThemeEditor";

// A theme's id is "mine-" plus the time in base 36; bumped if taken.
function newThemeId(taken) {
  let t = Date.now();
  while (taken.some((x) => x.id === `mine-${t.toString(36)}`)) t++;
  return `mine-${t.toString(36)}`;
}

// One Style card: the style's Kratt color, then accent, text and raised swatches.
function StyleCard({ style, mode, active, onPick }) {
  const preset = PRESETS.find((p) => p.id === themeIdFor(style, mode));
  const v = themeVars(preset);
  const c = (k) => `hsl(${v[`--st-c-${k}`]})`;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onPick(style)}
      className={`flex flex-col items-start gap-2 rounded-st border p-2 text-left transition-colors hover:border-st-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring ${active ? "border-st-primary ring-1 ring-st-primary" : "border-st-border"}`}
      style={{ background: c("background"), color: c("foreground"), "--st-kratt": v["--st-kratt"] }}
    >
      <Kratt size={46} />
      <span className="flex gap-1" aria-hidden="true">
        <span className="size-3 rounded-full border" style={{ background: preset.accent, borderColor: c("border") }} />
        <span className="size-3 rounded-full border" style={{ background: c("foreground"), borderColor: c("border") }} />
        <span className="size-3 rounded-full border" style={{ background: c("card"), borderColor: c("border") }} />
      </span>
      <span className="text-sm">{STYLE_NAMES[style]}</span>
    </button>
  );
}
const STYLE_NAMES = { ember: "Ember", deepred: "Deep red", chrome: "Chrome", green: "Racing green", calmsteel: "Calm steel" };

export default function AppearanceSection({ value, set }) {
  const shell = useShell();
  const extensionThemes = useExtensionThemes();
  const theme = resolveTheme(value, extensionThemes);
  const dirty = Object.keys(value.themeDraft || {}).length > 0;
  // Undo runs later, so it reads the settings as they are then.
  const latest = useRef(value);
  latest.current = value;

  // Picking a theme drops unsaved changes; Undo brings them back.
  const pick = (themeId) => {
    const before = { themeId: value.themeId, themeDraft: value.themeDraft };
    set({ themeId, themeDraft: {} });
    if (dirty) shell?.toast("Changes discarded", { label: "Undo", run: () => set(before) });
  };
  const kratt = styleOf(theme.id);
  const mode = kratt ? kratt.mode : isDark(theme.choices) ? "dark" : "light";
  const pickStyle = (style) => pick(themeIdFor(style, mode));
  const pickMode = (m) => m !== mode && pick(themeIdFor(kratt?.style ?? "ember", m));
  const edit = (patch) => set({ themeDraft: { ...value.themeDraft, ...patch } });
  const discard = () => set({ themeDraft: {} });

  const save = (name) => {
    const mine = value.customThemes;
    const saved = { id: newThemeId(mine), name: name || `My theme ${mine.length + 1}`, ...theme.choices };
    set({ customThemes: [...mine, saved], themeId: saved.id, themeDraft: {} });
  };

  const remove = (id) => {
    const index = value.customThemes.findIndex((t) => t.id === id);
    const gone = value.customThemes[index];
    if (!gone) return;
    const wasCurrent = value.themeId === id;
    set({ customThemes: value.customThemes.filter((t) => t.id !== id), ...(wasCurrent ? { themeId: "black", themeDraft: {} } : {}) });
    shell?.toast(`${gone.name} deleted`, {
      label: "Undo",
      run: () => {
        const now = latest.current.customThemes;
        if (now.some((t) => t.id === id)) return;
        const at = Math.min(index, now.length);
        set({ customThemes: [...now.slice(0, at), gone, ...now.slice(at)], ...(wasCurrent ? { themeId: id } : {}) });
      },
    });
  };

  return (
    <Section title="Appearance" description="Pick a theme, then change anything below. Changes show right away.">
      <Group title="Style">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {KRATT_STYLES.map((id) => <StyleCard key={id} style={id} mode={mode} active={kratt?.style === id} onPick={pickStyle} />)}
        </div>
      </Group>
      <div className="mt-5" />
      <Group title="Mode">
        <Segmented
          label="Mode"
          value={mode}
          onChange={pickMode}
          options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
        />
      </Group>
      <details className="mt-5" open={!kratt || undefined}>
        <summary className="cursor-pointer text-sm text-st-muted-foreground">More themes</summary>
        <ThemeCards currentId={theme.id} customThemes={value.customThemes} extensionThemes={extensionThemes} onPick={pick} onDelete={remove} />
      </details>
      <hr className="my-5 border-st-border" />
      <ThemeEditor name={theme.name} choices={theme.choices} dirty={dirty} onEdit={edit} onSave={save} onDiscard={discard} />

      <div className="mt-8" />
      <Group title="Text and motion">
        <Row label="Text size">
          <Segmented
            label="Text size"
            value={value.textSize}
            onChange={(textSize) => set({ textSize })}
            options={[
              { value: "small", label: "Small" },
              { value: "normal", label: "Normal" },
              { value: "large", label: "Large" },
            ]}
          />
        </Row>
        <Row label="Opening animation" description="The graph draws itself when the app opens. Click or press a key to skip it.">
          <Toggle label="Opening animation" checked={value.openingAnimation} onChange={(openingAnimation) => set({ openingAnimation })} />
        </Row>
        <Row label="Kratt moves" description="He blinks, hops and thinks. Off keeps him still.">
          <Toggle label="Kratt moves" checked={value.krattMoves} onChange={(krattMoves) => set({ krattMoves })} />
        </Row>
        <Row label="Reduce motion" description="Turns off all animation, including the opening.">
          <Toggle label="Reduce motion" checked={value.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
        </Row>
      </Group>
    </Section>
  );
}
