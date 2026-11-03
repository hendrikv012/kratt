import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { motionReduced } from "../../motion.js";
import useViewerKeys from "./useViewerKeys.js";
import "../artifacts.css";

const markdown = new MarkdownIt({ html: false, linkify: false });

// Plain text of rendered card Markdown, for screen readers.
function plain(html) {
  return (new DOMParser().parseFromString(html, "text/html").body.textContent || "").trim();
}

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Flip-card review. Got it / Again after a flip; a summary at the end.
export default function FlashcardsViewer({ items = [], onFinish }) {
  const rootRef = useRef(null);
  const [deck, setDeck] = useState(items);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [got, setGot] = useState(0);
  const [missed, setMissed] = useState([]);
  const [retry, setRetry] = useState(false);
  const [mode, setMode] = useState("flip");

  // The ancestor is only known once mounted.
  useLayoutEffect(() => {
    setMode(motionReduced(rootRef.current) ? "fade" : "flip");
  }, []);

  const done = deck.length > 0 && idx >= deck.length;
  const card = deck[idx];

  const move = (d) => {
    if (done) return;
    setIdx((i) => Math.max(0, Math.min(deck.length - 1, i + d)));
    setFlipped(false);
  };
  const grade = (right) => {
    if (!flipped || done) return;
    const nextGot = got + (right ? 1 : 0);
    const nextMissed = right ? missed : [...missed, card];
    setGot(nextGot);
    setMissed(nextMissed);
    setFlipped(false);
    setIdx(idx + 1);
    if (idx + 1 >= deck.length && !retry) onFinish?.({ right: nextGot, of: deck.length });
  };
  const restart = (next, isRetry) => {
    setDeck(next);
    setIdx(0);
    setFlipped(false);
    setGot(0);
    setMissed([]);
    setRetry(isRetry);
  };

  useViewerKeys(rootRef, {
    " ": () => !done && setFlipped((f) => !f),
    Enter: () => !done && setFlipped((f) => !f),
    ArrowRight: () => move(1),
    ArrowLeft: () => move(-1),
    g: () => grade(true),
    a: () => grade(false),
  });

  const front = useMemo(() => (card ? markdown.render(card.front || "") : ""), [card]);
  const back = useMemo(() => (card ? markdown.render(card.back || "") : ""), [card]);

  // Focus the summary once the last card is graded (the buttons vanish).
  useEffect(() => {
    const el = rootRef.current;
    if (done && el && (document.activeElement === document.body || el.contains(document.activeElement))) el.focus();
  }, [done]);

  const frontText = plain(front);
  const backText = plain(back);
  const faceText = flipped ? backText : frontText;

  let statusText = "";
  if (done) statusText = `Finished: ${got} got, ${missed.length} again`;
  else if (card) statusText = `Card ${idx + 1} of ${deck.length}, ${flipped ? "back" : "front"}: ${faceText}`;

  return (
    <div className="st-viewer st-flashcards" ref={rootRef} tabIndex={-1}>
      <div className="sr-only" aria-live="polite">{statusText}</div>
      {done ? (
        <div className="st-viewer-summary">
          <p>{got} got, {missed.length} again</p>
          <div className="st-viewer-bar">
            {missed.length > 0 && (
              <button type="button" className="st-ghost-button" onClick={() => restart(missed, true)}>
                Go through the {missed.length} again
              </button>
            )}
            <button type="button" className="st-ghost-button" onClick={() => restart(items, false)}>Start over</button>
          </div>
        </div>
      ) : card ? (
        <>
          <button
            type="button"
            className="st-flashcard"
            data-motion={mode}
            data-flipped={flipped ? "true" : "false"}
            aria-label={`${faceText}. ${flipped ? "Show front" : "Show back"}`}
            onClick={() => setFlipped((f) => !f)}
          >
            <span className="st-flashcard-face st-flashcard-front" aria-hidden={flipped} dangerouslySetInnerHTML={{ __html: front }} />
            <span className="st-flashcard-face st-flashcard-back" aria-hidden={!flipped} dangerouslySetInnerHTML={{ __html: back }} />
          </button>
          <div className="st-viewer-bar">
            <button type="button" className="st-ghost-button" onClick={() => move(-1)} disabled={idx === 0}>Previous</button>
            <span className="st-viewer-count">{idx + 1} / {deck.length}</span>
            <button type="button" className="st-ghost-button" onClick={() => move(1)} disabled={idx >= deck.length - 1}>Next</button>
          </div>
          <div className="st-viewer-bar">
            <button type="button" className="st-ghost-button" disabled={!flipped} onClick={() => grade(true)}>Got it</button>
            <button type="button" className="st-ghost-button" disabled={!flipped} onClick={() => grade(false)}>Again</button>
            <button type="button" className="st-ghost-button" onClick={() => restart(shuffled(deck), retry)}>Shuffle</button>
          </div>
        </>
      ) : (
        <p className="st-viewer-count">No cards.</p>
      )}
    </div>
  );
}
