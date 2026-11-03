import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { allPages } from "../data/tree";
import Dialog from "../dialogs/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { titleOf as sourceTitle } from "../sources/SourcesView";
import { ARTIFACT_TYPES, TYPE_LABELS } from "./format";
import { TYPE_ICONS } from "./icons";
import { useMakeArtifact } from "./useMakeArtifact";
import MakeProgress from "./MakeProgress";
import "../chats/chat.css";
import "./artifacts.css";

// Make an artifact by hand: pick a type and the notes, then Kratt makes it and it opens.
export default function NewArtifactDialog({ onClose }) {
  const { state } = useStudy();
  const shell = useShell();
  const make = useMakeArtifact();
  const [type, setType] = useState("");
  const [ids, setIds] = useState([]);
  const [topic, setTopic] = useState("");

  const labelOf = (id) => state.nodes[id]?.name ?? sourceTitle(state.sources.find((s) => s.id === id) ?? {});
  const options = [
    ...state.subjects.map((id) => ({ id, label: state.nodes[id]?.name, subject: true })),
    ...allPages(state)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => ({ id: n.id, label: n.name })),
    ...(state.sources ?? []).map((s) => ({ id: s.id, label: sourceTitle(s), source: true })),
  ].filter((o) => o.label && !ids.includes(o.id));

  const start = async () => {
    const made = await make.make({ type, ids, topic: topic.trim(), madeIn: null });
    if (made) {
      shell.open({ view: "artifact", id: made });
      onClose();
    }
  };

  return (
    <Dialog title="New artifact" onCancel={onClose} trapFocus>
      <div className="st-newart-types" role="radiogroup" aria-label="Type">
        {ARTIFACT_TYPES.map((t) => {
          const Icon = TYPE_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className="st-ghost-button st-newart-type"
              data-on={type === t || undefined}
              disabled={make.busy}
              onClick={() => setType(t)}
            >
              <Icon size={14} aria-hidden="true" /> {TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>
      <div className="st-chat-ctx">
        {ids.map((id) => (
          <span key={id} className="st-chat-pill">
            {labelOf(id)}
            <button type="button" aria-label={`Remove ${labelOf(id)}`} disabled={make.busy} onClick={() => setIds(ids.filter((x) => x !== id))}>
              <X size={12} />
            </button>
          </span>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="st-chat-pill" aria-label="Add note" disabled={make.busy}>
              <Plus size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="st-chat-picker">
            {options.length === 0 && <DropdownMenuLabel>Nothing more to add</DropdownMenuLabel>}
            {options.map((o) => (
              <DropdownMenuItem key={o.id} onSelect={() => setIds([...ids, o.id])}>
                {o.label}
                {o.subject && <span className="st-faint"> · subject</span>}
                {o.source && <span className="st-faint"> · source</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <input
        className="st-chats-search"
        aria-label="Focus"
        placeholder="Focus on (optional)"
        value={topic}
        disabled={make.busy}
        onChange={(e) => setTopic(e.target.value)}
      />
      {make.busy && <MakeProgress type={type} progress={make.progress} onCancel={make.cancel} />}
      {make.error && (
        <p className="st-artifact-error" role="alert">
          {make.error}{" "}
          <button type="button" className="st-ghost-button" onClick={make.clearError}>Dismiss</button>
        </p>
      )}
      <div className="st-newart-actions">
        <button type="button" className="st-ghost-button" onClick={onClose}>Close</button>
        <button type="button" className="st-ghost-button" onClick={start} disabled={!type || ids.length === 0 || make.busy}>
          {make.error ? "Try again" : "Make"}
        </button>
      </div>
    </Dialog>
  );
}
