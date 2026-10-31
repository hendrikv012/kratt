import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useStudy } from "../data/StudyProvider";

export function QuickNoteInput({ rows = 2 }) {
  const { actions } = useStudy();
  const [text, setText] = useState("");
  const add = () => {
    actions.addQuickNote(text);
    setText("");
  };
  return (
    <div className="st-quick-input">
      <textarea
        rows={rows}
        placeholder="Write a quick note"
        aria-label="New quick note"
        aria-keyshortcuts="Control+Enter"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
        }}
        // Keep the browser's own menu (spelling, cut, paste) instead of Home's.
        onContextMenu={(e) => e.stopPropagation()}
      />
      <div className="st-row st-quick-actions">
        <span className="st-faint st-small st-quick-hint">Ctrl+Enter to save</span>
        <button className="st-button st-button-small" disabled={!text.trim()} onClick={add}>
          Save note
        </button>
      </div>
    </div>
  );
}

const when = (time) =>
  new Date(time).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Its own tab: every quick note, newest first, editable in place.
export default function QuickNotesView() {
  const { state, actions } = useStudy();
  return (
    <article className="st-page">
      <h1 className="st-page-title">Notes</h1>
      <div className="st-page-meta">
        <span>Thoughts to sort out later. They're also on your home screen.</span>
      </div>
      <QuickNoteInput rows={3} />
      {state.quickNotes.length === 0 ? (
        <p className="st-empty">No notes yet.</p>
      ) : (
        <ul className="st-quick-list">
          {state.quickNotes.map((note, i) => (
            <li key={note.id} className="st-fx-row" style={{ "--i": i }}>
              <textarea
                value={note.text}
                aria-label="Note"
                rows={Math.min(8, note.text.split("\n").length + 1)}
                onChange={(e) => actions.updateQuickNote(note.id, e.target.value)}
              />
              <div className="st-row" style={{ justifyContent: "space-between" }}>
                <span className="st-faint st-small">{when(note.createdAt)}</span>
                <button className="st-icon-button" aria-label="Delete note" onClick={() => actions.deleteQuickNote(note.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
