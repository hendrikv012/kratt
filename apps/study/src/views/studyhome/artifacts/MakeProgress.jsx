import Kratt from "../kratt/Kratt";
import "./artifacts.css";

const NOUNS = { flashcards: "cards", slides: "slides", quiz: "questions" };

// Shown while Kratt makes an artifact: which part it is on (or what it is making), and Cancel.
export default function MakeProgress({ type, progress, onCancel }) {
  const text =
    progress && progress.of > 1
      ? `Making part ${progress.part} of ${progress.of}…`
      : `Kratt is making your ${NOUNS[type] ?? "study material"}…`;
  return (
    <div className="st-make-progress" role="status">
      <Kratt mode="think" size={28} />
      <span>{text}</span>
      <button type="button" className="st-ghost-button" onClick={onCancel}>Cancel</button>
    </div>
  );
}
