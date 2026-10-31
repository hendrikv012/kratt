import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import "./styles/toasts.css";

// Short messages at the bottom centre, from the app and from extensions.
// useToasts() owns the list and gives a stable toast(text, action?), which
// returns the toast's id, and dismiss(id); <Toasts items /> draws it. Each
// message stays 4 s, fading out over the last moment, and a fourth message
// pushes the oldest one out. The time stands still while the pointer is over
// a toast or something in it has focus.

export const TOAST_DURATION = 4000;
export const MAX_TOASTS = 3;
const FADE = 180;

let lastId = 0;

export function useToasts() {
  const [items, setItems] = useState([]);
  const live = useRef(new Map()); // id -> { dismiss, stop }

  useEffect(() => {
    const all = live.current;
    return () => all.forEach((t) => t.stop());
  }, []);

  const toast = useCallback((text, action) => {
    const id = ++lastId;
    let actionUsed = false;
    let gone = false;
    let left = TOAST_DURATION; // time still to run
    let since = 0; // when the clock last started
    let timers = [];
    const holds = new Set(); // "hover", "focus"

    const stop = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const setLeaving = (leaving) => setItems((list) => list.map((t) => (t.id === id && t.leaving !== leaving ? { ...t, leaving } : t)));
    const dismiss = () => {
      if (gone) return;
      gone = true;
      stop();
      live.current.delete(id);
      setItems((list) => list.filter((t) => t.id !== id));
    };
    const start = () => {
      since = Date.now();
      timers = [setTimeout(() => setLeaving(true), Math.max(0, left - FADE)), setTimeout(dismiss, left)];
    };
    const hold = (why, on) => {
      if (gone) return;
      const was = holds.size > 0;
      if (on) holds.add(why);
      else holds.delete(why);
      if (!was && holds.size > 0) {
        stop();
        left = Math.max(FADE, left - (Date.now() - since));
        setLeaving(false);
      } else if (was && holds.size === 0) start();
    };
    const actionDismiss = () => {
      if (actionUsed) return;
      actionUsed = true;
      action.run();
      dismiss();
    };

    live.current.set(id, { dismiss, stop });
    setItems((list) => {
      const next = [...list, { id, text: String(text), action, leaving: false, dismiss, actionDismiss, hold }];
      next.slice(0, -MAX_TOASTS).forEach((t) => live.current.get(t.id)?.stop());
      return next.slice(-MAX_TOASTS);
    });
    start();
    return id;
  }, []);

  const dismiss = useCallback((id) => live.current.get(id)?.dismiss(), []);

  return { items, toast, dismiss };
}

export default function Toasts({ items }) {
  return (
    <div className="st-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="st-toast" data-leaving={t.leaving || undefined}>
          <div
            className="st-toast-content"
            onMouseEnter={() => t.hold?.("hover", true)}
            onMouseLeave={() => t.hold?.("hover", false)}
            onFocus={() => t.hold?.("focus", true)}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && t.hold?.("focus", false)}
          >
            <span>{t.text}</span>
            {t.action && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => t.actionDismiss()}
              >
                {t.action.label}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
