import { Check, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { styleOf } from "../../theme/styles";
import { PRESETS, UI_FONTS, themeVars } from "../../theme/themes";

// One theme as a card with a small preview of its sidebar, type, accent and
// graph dots. `mine` adds a Delete button.
function ThemeCard({ theme, active, mine, onPick, onDelete }) {
  const v = themeVars(theme);
  const c = (k) => `hsl(${v[`--st-c-${k}`]})`;
  const f = UI_FONTS[theme.uiFont] || UI_FONTS.archivo;
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={active}
        aria-label={`Theme: ${theme.name}`}
        onClick={() => onPick(theme.id)}
        className={`block w-full rounded-st border p-1.5 text-left transition-colors hover:border-st-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-ring ${active ? "border-st-primary ring-1 ring-st-primary" : "border-st-border"}`}
      >
        <span className="flex h-14 overflow-hidden rounded-st-sm border" style={{ background: c("background"), borderColor: c("border") }} aria-hidden="true">
          <span className="h-full w-[24%] border-r" style={{ background: c("sidebar"), borderColor: c("sidebar-border") }}>
            <span className="mx-1.5 mt-2 block h-1 rounded-[1px]" style={{ background: c("muted-foreground"), opacity: 0.5 }} />
            <span className="mx-1.5 mt-1 block h-1 w-2/3 rounded-[1px]" style={{ background: c("muted-foreground"), opacity: 0.35 }} />
          </span>
          <span className="flex flex-1 flex-col justify-between p-1.5">
            <span style={{ fontFamily: f.display, fontStretch: f.stretch, fontWeight: f.weight, color: c("foreground"), fontSize: "0.95rem", lineHeight: 1 }}>Aa</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-6 rounded-[1px]" style={{ background: c("primary") }} />
              <span className="size-1.5 rounded-full" style={{ background: c("graph-node") }} />
              <span className="size-1.5 rounded-full" style={{ background: c("graph-node"), opacity: 0.45 }} />
            </span>
          </span>
        </span>
        <span className="mt-1.5 flex items-center gap-1.5 px-0.5 text-sm">
          <span className="truncate">{theme.name}</span>
          {active && <Check className="ml-auto size-3.5 text-st-primary" aria-hidden="true" />}
        </span>
      </button>
      {mine && (
        <Button
          variant="ghost"
          size="iconSm"
          className="absolute right-2 top-2 h-6 w-6 bg-st-popover/90"
          aria-label={`Delete ${theme.name}`}
          onClick={() => onDelete(theme.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

const GroupHead = ({ id, children }) => (
  <h3 id={id} className="mb-2 mt-5 text-xs font-medium text-st-muted-foreground">{children}</h3>
);

// The three groups: built in, mine, from extensions.
export default function ThemeCards({ currentId, customThemes, extensionThemes = [], onPick, onDelete }) {
  const grid = "grid grid-cols-3 gap-2";
  return (
    <div>
      <div role="group" aria-labelledby="st-themes-builtin">
        <GroupHead id="st-themes-builtin">Built in</GroupHead>
        <div className={grid}>
          {PRESETS.filter((p) => !styleOf(p.id)).map((p) => <ThemeCard key={p.id} theme={p} active={p.id === currentId} onPick={onPick} />)}
        </div>
      </div>
      <div role="group" aria-labelledby="st-themes-mine">
        <GroupHead id="st-themes-mine">Your themes</GroupHead>
        {customThemes.length ? (
          <div className={grid}>
            {customThemes.map((t) => (
              <ThemeCard key={t.id} theme={{ ...t, ...t.choices }} active={t.id === currentId} mine onPick={onPick} onDelete={onDelete} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-st-muted-foreground">Change a theme below and save it to keep it here.</p>
        )}
      </div>
      <div role="group" aria-labelledby="st-themes-ext">
        <GroupHead id="st-themes-ext">From extensions</GroupHead>
        {extensionThemes.length ? (
          <div className={grid}>
            {extensionThemes.map((t) => <ThemeCard key={t.id} theme={{ ...t.choices, id: t.id, name: t.name }} active={t.id === currentId} onPick={onPick} />)}
          </div>
        ) : (
          <p className="text-sm text-st-muted-foreground">Themes from extensions you install show up here.</p>
        )}
      </div>
    </div>
  );
}
