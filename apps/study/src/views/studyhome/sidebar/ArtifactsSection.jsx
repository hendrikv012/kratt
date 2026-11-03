import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { TYPE_ICONS } from "../artifacts/icons";
import { msOf, relativeTime } from "../chats/summary";

export default function ArtifactsSection() {
  const { state } = useStudy();
  const shell = useShell();
  const artifacts = [...(state.artifacts ?? [])].sort((a, b) => msOf(b.updated) - msOf(a.updated)).slice(0, 3);
  const now = Date.now();
  return (
    <>
      <div className="st-side-section st-side-section-row">
        <span>Artifacts</span>
        <button className="st-side-link" onClick={() => shell.open({ view: "artifacts" })}>
          See all
        </button>
      </div>
      {artifacts.length === 0 ? (
        <p className="st-side-empty">No artifacts yet</p>
      ) : (
        artifacts.map((artifact) => {
          const Icon = TYPE_ICONS[artifact.type] ?? TYPE_ICONS.flashcards;
          return (
            <button key={artifact.id} className="st-side-row" onClick={() => shell.open({ view: "artifact", id: artifact.id })}>
              <Icon size={14} aria-hidden="true" />
              <span className="st-side-text">{artifact.title || "Untitled"}</span>
              <span className="st-side-meta">{relativeTime(msOf(artifact.updated), now)}</span>
            </button>
          );
        })
      )}
    </>
  );
}
