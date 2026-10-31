import { BookCheck } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { dueForReview } from "../mastery";

export default function ReviewSection() {
  const { state } = useStudy();
  const shell = useShell();
  const due = dueForReview(state);
  if (!due.length) return null;
  return (
    <>
      <div className="st-side-section st-side-section-row">
        <span>Due for review</span>
        <span className="st-side-count">{due.length}</span>
      </div>
      {due.map((id) => (
        <button key={id} className="st-side-row" onClick={() => shell.open({ view: "node", id })}>
          <BookCheck size={14} aria-hidden="true" />
          <span className="st-side-text">{state.nodes[id]?.name || "Untitled"}</span>
        </button>
      ))}
    </>
  );
}
