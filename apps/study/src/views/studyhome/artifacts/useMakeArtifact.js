// Making an artifact from a component: gather the notes, ask Kratt, save the result.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { CHAT_MESSAGES, ChatError, createChatService } from "../chats/chatService";
import { createArtifactMaker } from "./maker";
import { gatherFull } from "./notes";

// make({ type, ids, topic, madeIn }) resolves to the new artifact's id, or null when it failed (error
// says why) or was cancelled. A result that arrives after cancel() or unmount is dropped.
export function useMakeArtifact() {
  const { state, actions, client } = useStudy();
  const shell = useShell();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const current = useRef(null); // the running make's AbortController
  const unmounted = useRef(false);
  const settings = useRef(shell?.chat);
  settings.current = shell?.chat;
  const latest = useRef({ state, actions });
  latest.current = { state, actions };

  const maker = useMemo(
    () => createArtifactMaker(createChatService({ client, address: () => settings.current?.address, local: () => settings.current?.local })),
    [client]
  );

  // Cancel shows at once; the answer still on its way is ignored.
  const cancel = useCallback(() => {
    current.current?.abort();
    current.current = null;
    setBusy(false);
    setProgress(null);
  }, []);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      current.current?.abort();
    };
  }, []);

  const make = useCallback(
    async ({ type, ids, topic = "", madeIn = null }) => {
      current.current?.abort();
      const control = new AbortController();
      current.current = control;
      const live = () => !unmounted.current && current.current === control && !control.signal.aborted;
      setBusy(true);
      setProgress(null);
      setError(null);
      try {
        const notes = gatherFull(latest.current.state, ids);
        const made = await maker.make({
          type,
          notes,
          topic,
          memory: settings.current?.memory,
          signal: control.signal,
          onProgress: (p) => live() && setProgress(p),
        });
        if (!live()) return null;
        return latest.current.actions.addArtifact({ type, madeFrom: ids, madeIn, ...made });
      } catch (e) {
        if (!live()) return null;
        if (e instanceof ChatError && e.code === "cancelled") return null;
        if (e instanceof ChatError) setError(e.message);
        else {
          console.error(e);
          setError(CHAT_MESSAGES["app-error"]);
        }
        return null;
      } finally {
        if (current.current === control) current.current = null;
        if (!unmounted.current && !control.signal.aborted) {
          setBusy(false);
          setProgress(null);
        }
      }
    },
    [maker]
  );

  return { make, busy, progress, error, cancel, clearError: useCallback(() => setError(null), []) };
}
