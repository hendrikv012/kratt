import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { ACCENTS, BASES, DENSITIES, GRAPH_COLORS, RADII, READ_FONTS, UI_FONTS } from "../../theme/themes";
import { Segmented } from "../controls";

const HEX = /^#[0-9a-f]{6}$/i;

function Swatch({ color, label, on, onClick }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`size-6 shrink-0 rounded-st-sm border border-st-border transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-st-ring ${on ? "ring-2 ring-st-foreground ring-offset-2 ring-offset-st-popover" : "hover:border-st-foreground/50"}`}
      style={{ background: color }}
    />
  );
}

// "Custom" chip with a native color input laid over it.
function CustomColor({ label, value, on, onChange }) {
  const hex = HEX.test(value) ? value : "#888888";
  return (
    <label
      title="Pick any color"
      className={`relative inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-st-sm border border-st-border px-1.5 text-xs text-st-muted-foreground hover:text-st-foreground ${on ? "ring-2 ring-st-foreground ring-offset-2 ring-offset-st-popover" : ""}`}
    >
      <span className="size-3 rounded-[2px] border border-st-border" style={{ background: hex }} aria-hidden="true" />
      Custom
      <input
        type="color"
        aria-label={label}
        value={hex}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

function FontSelect({ label, value, table, onChange }) {
  const cur = table[value] || Object.values(table)[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-8 w-56 items-center justify-between gap-2 rounded-st border border-st-input bg-transparent px-2.5 text-sm transition-colors hover:bg-st-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring"
        >
          <span className="truncate" style={{ fontFamily: cur.family }}>{cur.name}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {Object.entries(table).map(([id, f]) => (
            <DropdownMenuRadioItem key={id} value={id} style={{ fontFamily: f.family }}>{f.name}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const Row = ({ label, hint, children }) => (
  <div className="flex items-start gap-4 py-2.5">
    <div className="w-32 shrink-0 pt-1 text-sm">
      {label}
      {hint && <p className="text-xs text-st-muted-foreground">{hint}</p>}
    </div>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
  </div>
);

const options = (table) => Object.entries(table).map(([value, o]) => ({ value, label: o.name }));

// The Customize rows plus the save form. `choices` are the current theme's
// settings with the unsaved changes on top; `onEdit(patch)` adds to them.
export default function ThemeEditor({ name, choices: ch, dirty, onEdit, onSave, onDiscard }) {
  const [draftName, setDraftName] = useState("");
  const accentIsPreset = ACCENTS.some((a) => a.hex === ch.accent);
  const graphIsPreset = GRAPH_COLORS.some((g) => g.hex === ch.graph);
  const accentColor = HEX.test(ch.accent) ? ch.accent : "#888888";

  const pickBase = (id) => {
    const patch = { base: id };
    // A background that flips dark and light resets the graph dots to a
    // readable color, unless they follow the accent.
    if (BASES[ch.base].dark !== BASES[id].dark && ch.graph !== "accent") patch.graph = BASES[id].dark ? "#f0f0f0" : "#2d4f9a";
    onEdit(patch);
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Customize</h3>
        <span className="text-sm text-st-muted-foreground">{name}</span>
        {dirty && <Badge variant="secondary">Unsaved changes</Badge>}
      </div>
      <div className="mt-1 divide-y divide-st-border">
        <Row label="Accent" hint="Buttons, links, focus">
          {ACCENTS.map((a) => (
            <Swatch key={a.hex} color={a.hex} label={`Accent: ${a.name}`} on={ch.accent === a.hex} onClick={() => onEdit({ accent: a.hex })} />
          ))}
          <CustomColor label="Custom accent color" value={ch.accent} on={!accentIsPreset} onChange={(accent) => onEdit({ accent })} />
        </Row>
        <Row label="Background" hint="Dark to light">
          {Object.entries(BASES).filter(([, b]) => !b.hidden).map(([id, b]) => (
            <Swatch key={id} color={`hsl(${b.h} ${b.s}% ${b.l}%)`} label={`Background: ${b.name}`} on={ch.base === id} onClick={() => pickBase(id)} />
          ))}
          <span className="text-xs text-st-muted-foreground">{BASES[ch.base].name}</span>
        </Row>
        <Row label="Graph dots" hint="Brighter = known better">
          {GRAPH_COLORS.map((g) => (
            <Swatch
              key={g.hex}
              color={g.hex === "accent" ? accentColor : g.hex}
              label={`Graph dots: ${g.name}`}
              on={ch.graph === g.hex}
              onClick={() => onEdit({ graph: g.hex })}
            />
          ))}
          <CustomColor label="Custom graph dot color" value={ch.graph === "accent" ? ch.accent : ch.graph} on={!graphIsPreset} onChange={(graph) => onEdit({ graph })} />
        </Row>
        <Row label="Corners">
          <Segmented size="sm" label="Corners" value={ch.radius} options={options(RADII)} onChange={(radius) => onEdit({ radius })} />
        </Row>
        <Row label="Density">
          <Segmented size="sm" label="Density" value={ch.density} options={options(DENSITIES)} onChange={(density) => onEdit({ density })} />
        </Row>
        <Row label="Interface font">
          <FontSelect label="Interface font" value={ch.uiFont} table={UI_FONTS} onChange={(uiFont) => onEdit({ uiFont })} />
        </Row>
        <Row label="Page font" hint="The text of your pages">
          <FontSelect label="Page font" value={ch.readingFont} table={READ_FONTS} onChange={(readingFont) => onEdit({ readingFont })} />
        </Row>
      </div>
      <form
        className="mt-4 flex flex-wrap items-center gap-2 border-t border-st-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draftName.trim());
          setDraftName("");
        }}
      >
        <Input
          className="h-8 w-56"
          placeholder="Name your theme"
          aria-label="Theme name"
          maxLength={40}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <Button type="submit" size="sm">Save as my theme</Button>
        <Button type="button" variant="ghost" size="sm" disabled={!dirty} onClick={onDiscard}>Discard changes</Button>
      </form>
    </div>
  );
}
