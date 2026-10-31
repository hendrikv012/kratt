import { Folder } from "lucide-react";
import Dialog from "./Dialog";
import { useStudy } from "../data/StudyProvider";
import { canPlace } from "../data/operations";

// Pick another subject or folder to link a page into. The page stays where
// it is and also shows up there.
export default function LinkDialog({ pageId, onDone }) {
  const { state, actions } = useStudy();

  const rows = [];
  const walk = (id, depth) => {
    const node = state.nodes[id];
    rows.push({ id, depth, node, allowed: canPlace(state, pageId, id) });
    node.children.forEach((c) => state.nodes[c].type !== "page" && walk(c, depth + 1));
  };
  state.subjects.forEach((id) => walk(id, 0));

  return (
    <Dialog title={`Also put "${state.nodes[pageId].name}" in…`} onCancel={onDone}>
      <p className="st-dialog-text">The page stays where it is and also appears in the folder you pick.</p>
      <ul className="st-pick-list">
        {rows.map(({ id, depth, node, allowed }) => (
          <li key={id}>
            <button
              className="st-pick-row"
              style={{ paddingLeft: 10 + depth * 16 }}
              disabled={!allowed}
              onClick={() => {
                actions.link(pageId, id);
                onDone();
              }}
            >
              {node.type === "subject" ? (
                <span className="st-subject-mark" style={{ background: node.color }} aria-hidden="true" />
              ) : (
                <Folder size={14} aria-hidden="true" />
              )}
              <span className="st-truncate">{node.name}</span>
              {!allowed && <span className="st-faint st-small" style={{ marginLeft: "auto" }}>Already here</span>}
            </button>
          </li>
        ))}
      </ul>
      <button className="st-ghost-button st-dialog-cancel" onClick={onDone}>Cancel</button>
    </Dialog>
  );
}
