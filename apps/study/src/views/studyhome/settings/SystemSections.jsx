import { useRef, useEffect, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { Group, Kbd, Row, Section, Segmented, Toggle } from "./controls";
import { Button } from "../ui/button";
import { BINDABLE, FIXED, clashes, comboOf, keysOf } from "../shortcuts";

export function NotificationsSection({ value, set }) {
  return (
    <Section title="Notifications" description="Reminders the app may show you.">
      <Group>
        <Row label="Deadline reminders" description="A heads-up before tests and assignments.">
          <Toggle label="Deadline reminders" checked={value.deadlines} onChange={(v) => set({ deadlines: v })} />
        </Row>
        {value.deadlines && (
          <Row label="Remind me">
            <Segmented
              label="Remind me"
              value={value.deadlineLead}
              onChange={(v) => set({ deadlineLead: v })}
              options={[
                { value: "1", label: "1 day before" },
                { value: "3", label: "3 days before" },
                { value: "7", label: "A week before" },
              ]}
            />
          </Row>
        )}
        <Row label="Daily review reminder" description="Only when something is due for review.">
          <span className="st-row">
            <input
              type="time"
              className="st-input st-input-time"
              aria-label="Reminder time"
              value={value.reviewTime}
              disabled={!value.review}
              onChange={(e) => set({ reviewTime: e.target.value })}
            />
            <Toggle label="Daily review reminder" checked={value.review} onChange={(v) => set({ review: v })} />
          </span>
        </Row>
        <Row label="Quiet hours" description="No reminders during this time.">
          <span className="st-row">
            <input
              type="time"
              className="st-input st-input-time"
              aria-label="Quiet hours start"
              value={value.quietFrom}
              disabled={!value.quiet}
              onChange={(e) => set({ quietFrom: e.target.value })}
            />
            <span className="st-faint">to</span>
            <input
              type="time"
              className="st-input st-input-time"
              aria-label="Quiet hours end"
              value={value.quietTo}
              disabled={!value.quiet}
              onChange={(e) => set({ quietTo: e.target.value })}
            />
            <Toggle label="Quiet hours" checked={value.quiet} onChange={(v) => set({ quiet: v })} />
          </span>
        </Row>
      </Group>
    </Section>
  );
}

const split = (keys) => (keys === "Ctrl++" ? ["Ctrl", "+"] : keys.split("+"));

const WHERE = { "Tab bar": "With the mouse over a tab, or a tab focused.", Sidebar: "With a sidebar item selected and the sidebar focused." };

// One changeable shortcut. "Change" listens for the next keys; Escape stops
// listening. Keys another shortcut has are refused with a note.
function BindingRow({ binding, shortcuts, setShortcuts }) {
  const [listening, setListening] = useState(false);
  const [clash, setClash] = useState(null);
  const keys = keysOf(shortcuts, binding.id);

  useEffect(() => {
    if (!listening) return undefined;
    // Ahead of everything else, so Escape doesn't close Settings and the keys
    // don't also run whatever they're bound to.
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") return setListening(false);
      const next = comboOf(e);
      if (!next) return;
      const taken = clashes(shortcuts, binding.id, next);
      setListening(false);
      if (taken.length) return setClash(`${next} is already ${taken.join(" and ")}.`);
      setClash(null);
      setShortcuts({ [binding.id]: next === binding.keys ? undefined : next });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, shortcuts, binding, setShortcuts]);

  return (
    <Row label={binding.label} description={clash ?? WHERE[binding.context]}>
      <span className="flex items-center gap-2">
        {listening ? <span className="text-xs text-st-muted-foreground" aria-live="polite">Press keys…</span> : <Kbd keys={split(keys)} />}
        <Button variant="ghost" size="sm" className="border border-st-border" aria-label={`Change ${binding.label}`} onClick={() => setListening((on) => !on)}>
          {listening ? "Cancel" : "Change"}
        </Button>
        {keys !== binding.keys && !listening && (
          <Button variant="ghost" size="sm" aria-label={`Reset ${binding.label}`} onClick={() => setShortcuts({ [binding.id]: undefined })}>
            Reset
          </Button>
        )}
      </span>
    </Row>
  );
}

export function ShortcutsSection({ settings, setGroup }) {
  const shortcuts = settings?.shortcuts ?? {};
  const setShortcuts = (patch) => setGroup?.("shortcuts", patch);
  return (
    <Section title="Shortcuts" description="Keyboard shortcuts. Everything also works with the mouse.">
      <Group>
        {FIXED.map((sc) => (
          <Row key={sc.label} label={sc.label}>
            <Kbd keys={split(sc.keys)} />
          </Row>
        ))}
      </Group>
      <div className="mt-6" />
      <Group title="Tab bar and sidebar">
        {BINDABLE.map((b) => (
          <BindingRow key={b.id} binding={b} shortcuts={shortcuts} setShortcuts={setShortcuts} />
        ))}
      </Group>
    </Section>
  );
}

// The Study folder: where every page, quick note and source lives as a Markdown file.
function StudyFolderRow() {
  const { client, vault } = useStudy();
  const [path, setPath] = useState("");
  const [message, setMessage] = useState(null);
  const [askCopy, setAskCopy] = useState(false);
  const asking = useRef(false);
  asking.current = askCopy;

  useEffect(() => {
    let alive = true;
    client.folder().then((answer) => alive && setPath(answer.path)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  // Closing Settings without answering keeps the folder the app was using.
  useEffect(() => () => asking.current && vault.cancelSwitch(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const use = async () => {
    setMessage(null);
    try {
      const answer = await vault.switchFolder(path.trim());
      setPath(answer.path);
      setAskCopy(answer.empty);
      if (!answer.empty) setMessage("Now using this folder.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <Row label="Study folder" description="Your pages, notes, chats and sources are Markdown files in this folder.">
      <span className="st-row">
        <input
          className="st-input st-path"
          aria-label="Study folder"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          spellCheck={false}
        />
        <button className="st-ghost-button" onClick={use} disabled={!path.trim()}>
          Use this folder
        </button>
      </span>
      {askCopy && (
        <div className="st-confirm" role="alert">
          <p>This folder has no pages yet. Copy your pages there?</p>
          <div className="st-row">
            <button className="st-ghost-button" onClick={() => { vault.copyPagesHere(); setAskCopy(false); setMessage("Copying your pages."); }}>
              Copy my pages there
            </button>
            <button className="st-ghost-button" onClick={() => { vault.startEmpty(); setAskCopy(false); }}>
              Start empty
            </button>
          </div>
        </div>
      )}
      {message && <p className="st-hint">{message}</p>}
    </Row>
  );
}

export function DataSection({ value, set, reset }) {
  const [confirming, setConfirming] = useState(null);
  const [done, setDone] = useState([]);

  const confirmBox = (id, text, action, onConfirm) =>
    confirming === id && (
      <div className="st-confirm" role="alert">
        <p>{text}</p>
        <div className="st-row">
          <button
            className="st-danger-button"
            onClick={() => {
              onConfirm?.();
              setDone((d) => [...d, id]);
              setConfirming(null);
            }}
          >
            {action}
          </button>
          <button className="st-ghost-button" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      </div>
    );

  return (
    <Section title="Data" description="Everything is stored on this computer. Nothing is uploaded unless you use an online AI service.">
      <Group title="Storage">
        <StudyFolderRow />
      </Group>

      <Group title="Move your work">
        <Row label="Export" description="Download a copy of all your pages and study progress.">
          <span className="st-row">
            <button className="st-ghost-button st-outline">Markdown</button>
            <button className="st-ghost-button st-outline">JSON</button>
          </span>
        </Row>
        <Row label="Import" description="Bring in pages from another app.">
          <span className="st-row">
            <button className="st-ghost-button st-outline">From Notion</button>
            <button className="st-ghost-button st-outline">From Obsidian</button>
          </span>
        </Row>
      </Group>

      <Group title="Reset">
        <Row label="Clear AI memory" description="The AI forgets what you know and your corrections. Your notes stay.">
          {done.includes("memory") ? (
            <span className="st-faint">AI memory cleared</span>
          ) : (
            <button className="st-danger-ghost" onClick={() => setConfirming("memory")}>
              Clear AI memory
            </button>
          )}
        </Row>
        {confirmBox(
          "memory",
          "This deletes what the AI has learned about your knowledge, including every correction. Your pages and sources are not touched.",
          "Clear AI memory"
        )}
        <Row label="Reset settings" description="Puts every setting back to how it started.">
          {done.includes("settings") ? (
            <span className="st-faint">Settings reset</span>
          ) : (
            <button className="st-danger-ghost" onClick={() => setConfirming("settings")}>
              Reset settings
            </button>
          )}
        </Row>
        {confirmBox("settings", "Your widgets, theme and other choices go back to the defaults.", "Reset settings", reset)}
      </Group>
    </Section>
  );
}

export function AboutSection() {
  return (
    <Section title="About">
      <Group>
        <Row label="Version">
          <span className="st-faint">0.1 design preview</span>
        </Row>
      </Group>
    </Section>
  );
}
