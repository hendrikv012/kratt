import { useEffect, useMemo, useState } from "react";
import Kratt from "./Kratt";
import { OFFLINE_MESSAGE } from "../data/StudyProvider";
import { bridgeVars, resolveTheme, UI_FONTS } from "../theme/themes";
import { loadFont } from "../theme/fonts";
import "./splash.css";

// The opening screen. With `animate`: Kratt drops in, "KRATT" types in under him,
// he blinks and waves (SPLASH_SEQUENCE_MS); then a ready folder fades into Home,
// and otherwise he thinks (loading) or sleeps (offline) until it is. A click or
// key skips to that end state. Without `animate` it is a still screen shown only
// until the folder is ready. Its colors come from the saved style, since the
// app's own theme isn't applied before the folder opens.
export const SPLASH_SEQUENCE_MS = 1400;
export const SPLASH_FADE_MS = 250;

const LOADING_TEXT = "Opening your Study folder…";
const MODES = { loading: "think", offline: "sleep", ready: "idle" };

export default function Splash({ phase, animate, appearance, onDone }) {
  const [playing, setPlaying] = useState(animate);
  const choices = useMemo(() => resolveTheme(appearance).choices, [appearance]);
  const style = useMemo(() => bridgeVars(choices), [choices]);
  const fading = animate && !playing && phase === "ready";

  const uiFont = UI_FONTS[choices.uiFont]?.font;
  useEffect(() => {
    if (uiFont) loadFont(uiFont);
  }, [uiFont]);

  useEffect(() => {
    if (!playing) return;
    const end = () => setPlaying(false);
    const timer = setTimeout(end, SPLASH_SEQUENCE_MS);
    window.addEventListener("pointerdown", end);
    window.addEventListener("keydown", end);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", end);
      window.removeEventListener("keydown", end);
    };
  }, [playing]);

  useEffect(() => {
    if (playing || phase !== "ready") return;
    if (!animate) {
      onDone();
      return;
    }
    const timer = setTimeout(onDone, SPLASH_FADE_MS);
    return () => clearTimeout(timer);
    // onDone is called once, for the phase and stage it was due at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, phase, animate]);

  const text = playing || phase === "ready" ? null : phase === "offline" ? OFFLINE_MESSAGE : LOADING_TEXT;
  return (
    <div
      className="st-splash"
      role="status"
      aria-label={text ?? "Opening KRATT"}
      data-playing={playing || undefined}
      data-fading={fading || undefined}
      data-still={!animate || undefined}
      style={style}
    >
      <div className="st-splash-kratt">
        <Kratt size={96} mode={playing ? "idle" : MODES[phase]} />
      </div>
      <div className="st-splash-word" aria-hidden="true">KRATT</div>
      {text && <p className="st-splash-text">{text}</p>}
    </div>
  );
}
