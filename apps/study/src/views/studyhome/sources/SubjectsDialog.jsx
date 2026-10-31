import { useState } from "react";
import Dialog from "../dialogs/Dialog";
import { useStudy } from "../data/StudyProvider";
import { titleOf } from "./SourcesView";

// Tick the subjects a source belongs to. Done saves the whole set at once.
export default function SubjectsDialog({ sourceId, onDone }) {
  const { state, actions } = useStudy();
  const source = state.sources.find((s) => s.id === sourceId);
  const [ticked, setTicked] = useState(() => new Set(source?.subjects ?? []));
  if (!source) return null;
  const title = `Subjects for "${titleOf(source)}"`;

  if (state.subjects.length === 0) {
    return (
      <Dialog title={title} onCancel={onDone}>
        <p className="st-dialog-text">Make a subject in the sidebar first</p>
        <button className="st-ghost-button st-dialog-cancel" onClick={onDone}>Close</button>
      </Dialog>
    );
  }

  const flip = (id) =>
    setTicked((t) => {
      const next = new Set(t);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Dialog title={title} onCancel={onDone}>
      <ul className="st-pick-list">
        {state.subjects.map((id) => (
          <li key={id}>
            <label className="st-pick-row">
              <span className="st-subject-mark" style={{ background: state.nodes[id].color }} aria-hidden="true" />
              <span className="st-truncate">{state.nodes[id].name}</span>
              <input
                type="checkbox"
                className="st-src-check"
                style={{ marginLeft: "auto" }}
                checked={ticked.has(id)}
                onChange={() => flip(id)}
                aria-label={state.nodes[id].name}
              />
            </label>
          </li>
        ))}
      </ul>
      <div className="st-src-dialog-actions">
        <button className="st-ghost-button" onClick={onDone}>Cancel</button>
        <button
          className="st-button"
          onClick={() => {
            actions.setSourceSubjects(sourceId, state.subjects.filter((id) => ticked.has(id)));
            onDone();
          }}
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}
