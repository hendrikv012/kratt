import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { motionReduced } from "../../motion.js";
import useViewerKeys from "./useViewerKeys.js";
import "../artifacts.css";

const markdown = new MarkdownIt({ html: false, linkify: false });

// Plain text of rendered Markdown, for screen readers.
function plain(html) {
  return (new DOMParser().parseFromString(html, "text/html").body.textContent || "").trim();
}

// One question at a time; pick a choice, see Right / Not quite plus why.
export default function QuizViewer({ items = [], onFinish }) {
  const rootRef = useRef(null);
  const nextRef = useRef(null);
  const [runs, setRuns] = useState(0);
  const [deck, setDeck] = useState(items);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [right, setRight] = useState(0);
  const [missed, setMissed] = useState([]);
  const [retry, setRetry] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setAnimate(!motionReduced(rootRef.current));
  }, []);

  const done = deck.length > 0 && idx >= deck.length;
  const item = deck[idx];
  const choices = useMemo(() => item?.choices || [], [item]);
  const answered = picked !== null;
  const correctIdx = choices.findIndex((c) => c.right);

  const pick = (i) => {
    if (done || answered || !choices[i]) return;
    setPicked(i);
    if (choices[i].right) setRight((r) => r + 1);
    else setMissed((m) => [...m, item]);
  };
  const advance = () => {
    if (done || !answered) return;
    setPicked(null);
    setIdx(idx + 1);
    if (idx + 1 >= deck.length && !retry) onFinish?.({ right, of: deck.length });
  };
  const restart = (next, isRetry) => {
    setDeck(next);
    setIdx(0);
    setPicked(null);
    setRight(0);
    setMissed([]);
    setRetry(isRetry);
    setRuns((n) => n + 1);
  };

  const keys = { Enter: advance };
  for (let n = 1; n <= 9; n += 1) keys[String(n)] = () => pick(n - 1);
  useViewerKeys(rootRef, keys);

  const question = useMemo(() => (item ? markdown.render(item.question || "") : ""), [item]);
  const why = useMemo(() => (item ? markdown.render(item.why || "") : ""), [item]);
  const rest = useMemo(() => (item?.rest ? markdown.render(item.rest) : ""), [item]);
  const choiceHtml = useMemo(() => choices.map((c) => markdown.renderInline(c.text || "")), [choices]);

  // The picked choice locks, so hand focus to Next (it takes Enter natively).
  useEffect(() => {
    const el = rootRef.current;
    if (picked !== null && el && (document.activeElement === document.body || el.contains(document.activeElement))) nextRef.current?.focus();
  }, [picked]);

  // A restart unmounts the button that was focused; land on the viewer.
  useEffect(() => {
    const el = rootRef.current;
    if (runs > 0 && el && (document.activeElement === document.body || el.contains(document.activeElement))) el.focus();
  }, [runs]);

  // Focus the score once the last question is answered (the choices vanish).
  useEffect(() => {
    const el = rootRef.current;
    if (done && el && (document.activeElement === document.body || el.contains(document.activeElement))) el.focus();
  }, [done]);

  let statusText = "";
  if (done) statusText = `Finished: ${right} of ${deck.length} right`;
  else if (item && answered) {
    const ok = choices[picked].right;
    statusText = `${ok ? "Right" : "Not quite"}.${ok || correctIdx < 0 ? "" : ` Right answer: ${plain(choiceHtml[correctIdx])}.`} ${plain(why)} ${plain(rest)}`.trim();
  } else if (item) statusText = `Question ${idx + 1} of ${deck.length}: ${plain(question)}`;

  const last = idx >= deck.length - 1;

  return (
    <div className="st-viewer st-quiz" ref={rootRef} tabIndex={-1}>
      <div className="sr-only" aria-live="polite">{statusText}</div>
      {done ? (
        <div className="st-viewer-summary">
          <p>{right} of {deck.length}</p>
          <div className="st-viewer-bar">
            {missed.length > 0 && (
              <button type="button" className="st-ghost-button" onClick={() => restart(missed, true)}>
                Retry the wrong ones
              </button>
            )}
            <button type="button" className="st-ghost-button" onClick={() => restart(items, false)}>Start over</button>
          </div>
        </div>
      ) : item ? (
        <>
          <span className="st-viewer-count">{idx + 1} / {deck.length}</span>
          <div className="st-quiz-question" dangerouslySetInnerHTML={{ __html: question }} />
          <div className="st-quiz-choices">
            {choices.map((c, i) => {
              const state = !answered ? "" : c.right ? "right" : i === picked ? "wrong" : "";
              return (
                <button
                  key={i}
                  type="button"
                  className="st-quiz-choice"
                  data-state={state}
                  data-motion={animate && state ? "pop" : undefined}
                  aria-disabled={answered ? "true" : undefined}
                  onClick={() => pick(i)}
                >
                  <span className="st-quiz-key" aria-hidden="true">{i + 1}</span>
                  <span className="st-quiz-text" dangerouslySetInnerHTML={{ __html: choiceHtml[i] }} />
                  {state === "right" && <span className="st-quiz-mark">{"✓ Right answer"}</span>}
                  {state === "wrong" && <span className="st-quiz-mark">{"✗ Your pick"}</span>}
                </button>
              );
            })}
          </div>
          {answered && (
            <div className="st-quiz-why" data-motion={animate ? "pop" : undefined}>
              <strong>{choices[picked].right ? "✓ Right" : "✗ Not quite"}</strong>
              <div dangerouslySetInnerHTML={{ __html: why }} />
              {rest && <div className="st-quiz-rest" dangerouslySetInnerHTML={{ __html: rest }} />}
            </div>
          )}
          <div className="st-viewer-bar">
            <button type="button" className="st-ghost-button" ref={nextRef} aria-disabled={answered ? undefined : "true"} onClick={advance}>
              {last ? "See score" : "Next"}
            </button>
          </div>
        </>
      ) : (
        <p className="st-viewer-count">No questions.</p>
      )}
    </div>
  );
}
