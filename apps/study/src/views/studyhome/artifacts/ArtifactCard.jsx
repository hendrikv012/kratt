import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { TYPE_ICONS } from "./icons";
import { itemCount } from "./format";
import "./artifacts.css";

// An artifact named in a chat answer: its title and size, with Open.
export default function ArtifactCard({ id }) {
  const { state } = useStudy();
  const shell = useShell();
  const artifact = state.artifacts.find((a) => a.id === id);
  if (!artifact) return <div className="st-chat-soft">Artifact deleted</div>;
  const Icon = TYPE_ICONS[artifact.type];
  return (
    <div className="st-artifact-card">
      <Icon size={16} aria-hidden="true" />
      <span className="st-truncate">{artifact.title}</span>
      <span className="st-faint">{itemCount(artifact.type, artifact.items.length)}</span>
      <button type="button" className="st-ghost-button" onClick={() => shell.open({ view: "artifact", id })}>
        Open
      </button>
    </div>
  );
}
