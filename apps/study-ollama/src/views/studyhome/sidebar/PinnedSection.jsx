import { FileText, PinOff } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";

export default function PinnedSection() {
  const { state, actions } = useStudy();
  const shell = useShell();
  const ids = (state.pinned ?? []).filter((id) => state.nodes[id]);
  if (!ids.length) return null;
  return (
    <>
      <div className="st-side-section">Pinned</div>
      {ids.map((id) => {
        const name = state.nodes[id].name || "Untitled";
        const current = shell.route.view === "node" && shell.route.id === id;
        return (
          <div key={id} className="st-side-pinned">
            <a
              href="#"
              className="st-side-row"
              aria-current={current ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                shell.open({ view: "node", id });
              }}
            >
              <FileText size={14} aria-hidden="true" />
              <span className="st-side-text">{name}</span>
            </a>
            <button className="st-icon-button st-side-unpin" aria-label={`Unpin ${name}`} onClick={() => actions.unpinPage(id)}>
              <PinOff size={13} />
            </button>
          </div>
        );
      })}
    </>
  );
}
