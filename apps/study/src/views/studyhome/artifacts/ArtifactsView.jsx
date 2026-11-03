import { useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { foldersInside, pagesInside } from "../data/tree";
import { msOf, relativeTime } from "../chats/summary";
import Kratt from "../kratt/Kratt";
import NewArtifactDialog from "./NewArtifactDialog";
import { ARTIFACT_TYPES, TYPE_LABELS, itemCount } from "./format";
import { TYPE_ICONS } from "./icons";
import { madeFromChips } from "./madeFrom";
import "../chats/chat.css";
import "./artifacts.css";

// Whether an artifact was made from the subject, something inside it, or a source filed under it.
function inSubject(state, artifact, subjectId) {
  const inside = new Set([subjectId, ...foldersInside(state, subjectId), ...pagesInside(state, subjectId)]);
  return artifact.madeFrom.some(
    (id) => inside.has(id) || state.sources?.find((s) => s.id === id)?.subjects?.includes(subjectId)
  );
}

function madeFromText(state, artifact) {
  const names = madeFromChips(state, artifact.madeFrom).map((c) => c.label);
  const more = names.length - 2;
  return `${names.slice(0, 2).join(", ")}${more > 0 ? ` +${more}` : ""}`;
}

// The Artifacts screen (route `artifacts`): every artifact, newest first, with a search and
// filters by type and subject.
export default function ArtifactsView() {
  const { state } = useStudy();
  const shell = useShell();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [subject, setSubject] = useState("");
  const [making, setMaking] = useState(false);
  const all = [...(state.artifacts ?? [])].sort((a, b) => msOf(b.updated) - msOf(a.updated));
  const q = query.trim().toLowerCase();
  const artifacts = all.filter(
    (a) =>
      (!q || (a.title || "Untitled").toLowerCase().includes(q)) &&
      (!type || a.type === type) &&
      (!subject || inSubject(state, a, subject))
  );
  const now = Date.now();

  return (
    <section className="st-page st-chats" aria-label="Artifacts">
      <h1 className="st-page-title">Artifacts</h1>
      {all.length === 0 ? (
        <div className="st-artifacts-empty">
          <Kratt size={72} label="Kratt" />
          <p className="st-empty">No artifacts yet. Ask Kratt to make flashcards, slides or a quiz from your notes.</p>
          <button type="button" className="st-ghost-button" onClick={() => setMaking(true)}>New artifact</button>
        </div>
      ) : (
        <>
          <div className="st-artifacts-bar">
            <input
              type="search"
              className="st-chats-search"
              aria-label="Search artifacts"
              placeholder="Search artifacts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="st-chats-search" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {ARTIFACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select className="st-chats-search" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">All subjects</option>
              {state.subjects.map((id) => (
                <option key={id} value={id}>
                  {state.nodes[id].name}
                </option>
              ))}
            </select>
            <button type="button" className="st-ghost-button" onClick={() => setMaking(true)}>New artifact</button>
          </div>
          {artifacts.length === 0 && <p className="st-empty">No artifacts match</p>}
          <ul className="st-list st-chats-list">
            {artifacts.map((artifact) => {
              const Icon = TYPE_ICONS[artifact.type] ?? TYPE_ICONS.flashcards;
              const line = [
                `${TYPE_LABELS[artifact.type]}, ${itemCount(artifact.type, artifact.items.length)}`,
                madeFromText(state, artifact),
                artifact.lastScore && `${artifact.lastScore.right} of ${artifact.lastScore.of}`,
              ].filter(Boolean);
              return (
                <li key={artifact.id} className="st-chats-row">
                  <button className="st-list-row st-chats-main" onClick={() => shell.open({ view: "artifact", id: artifact.id })}>
                    <Icon size={14} className="st-list-icon" aria-hidden="true" />
                    <span className="st-chats-text">
                      <span className="st-chats-title st-truncate">{artifact.title || "Untitled"}</span>
                      <span className="st-chats-answer st-truncate">{line.join(" · ")}</span>
                    </span>
                    <span className="st-chats-time">{relativeTime(msOf(artifact.updated), now)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {making && <NewArtifactDialog onClose={() => setMaking(false)} />}
    </section>
  );
}
