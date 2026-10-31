import { useTheme } from "../hooks/theme.jsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "../components/ui/dialog.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../components/ui/table.jsx";

/**
 * Internal, dev-only kitchen-sink page for validating design tokens
 * (colors, radius, shadows, fonts) against the real UI primitives this
 * app actually has, before rolling token changes out to real screens.
 * Mirrors open-notebook/frontend's app/dev/design/page.tsx.
 */
export default function DesignPreview() {
  // Uses the app's real theme system (core/theme/manager.js applies every
  // token as an inline style on documentElement, overriding any plain
  // data-theme CSS toggle) so this preview reflects what users actually see.
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "minimal-light" ? "dracula" : "minimal-light");
  };

  return (
    <div
      className="h-full overflow-y-auto p-8 space-y-10"
      style={{
        backgroundColor: "rgb(var(--bg))",
        color: "rgb(var(--text))",
        fontFamily: "var(--font-family)",
      }}
    >
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Design Preview</h1>
        <button className="obsidian-button primary" onClick={toggleTheme}>
          Toggle theme ({theme})
        </button>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-3">Palette</h2>
        <div className="grid grid-cols-4 gap-3">
          {[
            ["bg", "--bg"],
            ["panel", "--panel"],
            ["panel-secondary", "--panel-secondary"],
            ["border", "--border"],
            ["text", "--text"],
            ["text-secondary", "--text-secondary"],
            ["muted", "--muted"],
            ["accent", "--accent"],
            ["danger", "--danger"],
            ["success", "--success"],
            ["warning", "--warning"],
            ["info", "--info"],
          ].map(([label, varName]) => (
            <div key={varName} className="space-y-1">
              <div
                className="h-14 rounded-md border"
                style={{
                  backgroundColor: `rgb(var(${varName}))`,
                  borderColor: "rgb(var(--border))",
                }}
              />
              <div className="text-xs" style={{ color: "rgb(var(--text-secondary))" }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Typography</h2>
        <div className="space-y-2">
          <div className="text-2xl font-semibold">Display / 24px</div>
          <div className="text-xl">Heading / 18px</div>
          <div className="text-base">Body / 14px — the quick brown fox jumps over the lazy dog</div>
          <div className="text-sm" style={{ color: "rgb(var(--text-secondary))" }}>
            Secondary / 13px
          </div>
          <div className="text-xs" style={{ fontFamily: "var(--font-mono)" }}>
            Mono / 11px — const x = 42;
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Radius + shadow</h2>
        <div className="flex gap-4">
          <div
            className="w-24 h-24 shadow-sm"
            style={{ backgroundColor: "rgb(var(--panel))", borderRadius: "var(--radius)" }}
          />
          <div
            className="w-24 h-24 shadow-md"
            style={{ backgroundColor: "rgb(var(--panel))", borderRadius: "var(--radius)" }}
          />
          <div
            className="w-24 h-24 shadow-lg"
            style={{ backgroundColor: "rgb(var(--panel))", borderRadius: "var(--radius)" }}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Buttons</h2>
        <div className="flex gap-3 items-center">
          <button className="obsidian-button">Default</button>
          <button className="obsidian-button primary">Primary</button>
          <button className="obsidian-button small">Small</button>
          <button className="obsidian-button icon-only">★</button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Form</h2>
        <div className="max-w-sm space-y-3">
          <input className="obsidian-input" placeholder="Text input" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Table</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Example row</TableCell>
              <TableCell>Active</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Dialog</h2>
        <Dialog>
          <DialogTrigger asChild>
            <button className="obsidian-button">Open dialog</button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Example dialog</DialogTitle>
              <DialogDescription>Uses the same primitive real screens use.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
