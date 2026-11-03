import { useEffect, useMemo, useRef, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import Dialog, { Choice } from "../dialogs/Dialog";
import { titleOf as chatTitleOf } from "../chats/summary";
import { TYPE_LABELS, formatArtifact, usableItems } from "./format";
import { coverageLine, madeFromChips } from "./madeFrom";
import { useMakeArtifact } from "./useMakeArtifact";
import FullMode from "./FullMode";
import MakeProgress from "./MakeProgress";
import FlashcardsViewer from "./viewers/FlashcardsViewer";
import SlidesViewer from "./viewers/SlidesViewer";
import QuizViewer from "./viewers/QuizViewer";
import useViewerKeys from "./viewers/useViewerKeys";
import "./artifacts.css";

const VIEWERS = { flashcards: FlashcardsViewer, slides: SlidesViewer, quiz: QuizViewer };

// An artifact's tab (route `artifact`): the header, then the viewer for its type.
export default function ArtifactView({ id }) {
  const { state, actions } = useStudy();
  const shell = useShell();
  const make = useMakeArtifact();
  const artifact = state.artifacts.find((a) => a.id === id);
  const rootRef = useRef(null);
  const [full, setFull] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(artifact?.title ?? "");
  useEffect(() => setTitle(artifact?.title ?? ""), [artifact?.title, id]);

  const usable = useMemo(() => (artifact ? usableItems(artifact.type, artifact.items) : []), [artifact]);
  const canFull = usable.length > 0;
  // F goes full screen, unless another dialog of the app is open.
  const otherDialog = () =>
    [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some((el) => !el.classList.contains("st-fullmode"));
  useViewerKeys(rootRef, { f: () => canFull && !full && !deleting && !otherDialog() && setFull(true) });
  if (!artifact) return null;

  const Viewer = VIEWERS[artifact.type] ?? FlashcardsViewer;
  const unreadable = artifact.items.length - usable.length;
  const chips = madeFromChips(state, artifact.madeFrom);
  const chat = artifact.madeIn?.kind === "chat" ? state.chats.find((c) => c.id === artifact.madeIn.id) : null;
  const page = artifact.madeIn?.kind === "page" ? state.nodes[artifact.madeIn.id] : null;
  const madeIn = chat
    ? { label: chatTitleOf(chat), go: () => shell.chat.open(chat.id) }
    : page
      ? { label: page.name || "Untitled", go: () => shell.open({ view: "node", id: page.id }) }
      : null;

  const openChip = (chip) => shell.open(chip.kind === "source" ? { view: "source", id: chip.id } : { view: "node", id: chip.id });
  const tryAgain = async () => {
    const made = await make.make({ type: artifact.type, ids: artifact.madeFrom, topic: "", madeIn: artifact.madeIn });
    if (made) shell.open({ view: "artifact", id: made });
  };
  const remove = () => {
    setDeleting(false);
    actions.deleteArtifact(id);
  };

  const viewer = (
    <Viewer key={id} items={usable} onFinish={artifact.type === "slides" ? undefined : (score) => actions.recordScore(id, score)} />
  );

  return (
    <section className="st-page st-artifact" aria-label={artifact.title} ref={rootRef}>
      <header className="st-artifact-head">
        <span className="st-artifact-type">{TYPE_LABELS[artifact.type]}</span>
        <input
          className="st-page-title st-title-input"
          value={title}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== artifact.title && actions.renameArtifact(id, title)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onContextMenu={(e) => e.stopPropagation()}
        />
        <p className="st-artifact-meta">{coverageLine(artifact)}</p>
        {chips.length > 0 && (
          <div className="st-artifact-chips">
            {chips.map((chip) =>
              chip.kind === "missing" ? (
                <span key={chip.id} className="st-artifact-chip" data-kind="missing">{chip.label}</span>
              ) : (
                <button key={chip.id} type="button" className="st-artifact-chip" data-kind={chip.kind} onClick={() => openChip(chip)}>
                  {chip.label}
                </button>
              )
            )}
          </div>
        )}
        {artifact.lastScore && <p className="st-artifact-meta">Last score: {artifact.lastScore.right} of {artifact.lastScore.of}</p>}
        <div className="st-artifact-actions">
          {madeIn && (
            <button type="button" className="st-ghost-button" onClick={madeIn.go}>Made in {madeIn.label}</button>
          )}
          {canFull && (
            <button type="button" className="st-ghost-button" onClick={() => setFull(true)}>Full screen</button>
          )}
          <button type="button" className="st-ghost-button" onClick={tryAgain} disabled={make.busy}>Try again</button>
          <button type="button" className="st-ghost-button" onClick={() => setDeleting(true)}>Delete</button>
        </div>
        {make.busy && <MakeProgress type={artifact.type} progress={make.progress} onCancel={make.cancel} />}
        {make.error && (
          <p className="st-artifact-error" role="alert">
            {make.error}{" "}
            <button type="button" className="st-ghost-button" onClick={make.clearError}>Dismiss</button>
          </p>
        )}
      </header>

      {unreadable > 0 && (
        <p className="st-artifact-notice">{unreadable} {unreadable === 1 ? "item" : "items"} couldn't be read</p>
      )}
      {usable.length === 0 && artifact.items.length > 0 ? (
        <pre className="st-artifact-raw">{formatArtifact(artifact.type, artifact.items)}</pre>
      ) : (
        <FullMode open={full} title={artifact.title} onClose={() => setFull(false)}>
          {viewer}
        </FullMode>
      )}
      {deleting && (
        <Dialog title="Delete artifact" onCancel={() => setDeleting(false)}>
          <Choice title="Delete" description={`"${artifact.title}" will be removed from your study folder.`} danger onClick={remove} />
          <Choice title="Cancel" onClick={() => setDeleting(false)} />
        </Dialog>
      )}
    </section>
  );
}
