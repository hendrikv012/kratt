import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { createIngest } from "./ingest";

// The app-wide upload queue: every drop, paste or pick goes through add(). It
// plans at once (the sources show straight away), runs one batch at a time, and
// reports through `status`:
//   { running, index, total, name, doneBytes, totalBytes, summary }
// `summary` is the last finished batch's line, until the next batch starts.
// Tests can provide their own { add, cancel, status } through UploadsContext.

export const UploadsContext = createContext(null);
export const useUploads = () => useContext(UploadsContext);

const IDLE = { running: false, index: 0, total: 0, name: "", doneBytes: 0, totalBytes: 0, summary: "", details: [] };

export function summaryOf({ added, existing, notSaved, skipped, cancelled = 0 }, subjectName) {
  return [
    `Added ${added} to ${subjectName}`,
    existing > 0 && `${existing} already there`,
    notSaved > 0 && `${notSaved} not saved`,
    skipped > 0 && `${skipped} skipped`,
    cancelled > 0 && `${cancelled} cancelled`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function UploadsProvider({ children }) {
  const study = useStudy();
  const shell = useShell();
  const [status, setStatus] = useState(IDLE);
  const queue = useRef(Promise.resolve());
  const waiting = useRef(0);
  const controllers = useRef(new Set());
  // The latest of these, so add() can stay one stable function.
  const live = useRef();
  live.current = { study, toast: shell?.toast };

  useEffect(() => () => controllers.current.forEach((c) => c.abort()), []);

  const add = useCallback(async (intake, subjectId, { onAccepted } = {}) => {
    const { study, toast } = live.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    const release = study.holdUploads?.();
    try {
      await study.client.folder();
      if (controller.signal.aborted) { controllers.current.delete(controller); release?.(); return; }
    } catch (error) {
      controllers.current.delete(controller);
      release?.();
      toast?.(error?.message ?? String(error));
      return;
    }
    const ingest = createIngest({ client: study.client, actions: study.actions, getState: study.getState });
    if (!study.getState().subjects.includes(subjectId)) subjectId = null;
    const subjectName = subjectId ? (study.getState().nodes[subjectId]?.name ?? subjectId) : "Unsorted";
    const planned = ingest.plan(intake, subjectId, {
      confirm: (count) => window.confirm(`Add ${count} files to ${subjectName}?`),
    });
    if (planned.cancelled || (!planned.sources.length && !planned.existing.length && !planned.skipped)) {
      controllers.current.delete(controller); release?.(); return;
    }
    onAccepted?.();
    waiting.current += 1;
    setStatus((s) => ({ ...s, running: true, summary: "" }));
    const job = async () => {
      try {
        const result = await ingest.run(planned, {
          signal: controller.signal,
          onProgress: ({ index, total, name, doneBytes, totalBytes }) =>
            setStatus({ running: true, index, total, name, doneBytes, totalBytes, summary: "" }),
        });

        if (result.messages[0]) toast?.(`${result.messages[0].name}: ${result.messages[0].message}`);
        setStatus({ ...IDLE, running: waiting.current > 1, summary: summaryOf(result, subjectName), details: [...result.messages, ...(intake.skipped || []).filter((s) => s.reason !== "hidden").map((s) => ({ name: s.name, message: s.reason === "too large" ? "Over the 50 GB limit" : "Could not read this item" }))] });
      } catch (error) {
        toast?.(error?.message ?? String(error));
        setStatus({ ...IDLE, running: waiting.current > 1, summary: "Upload stopped. Check your Study folder connection." });
      } finally {
        waiting.current -= 1;
        release?.();
        controllers.current.delete(controller);
      }
    };
    queue.current = queue.current.then(job, job);
    await queue.current;
  }, []);

  // Stops the current request and discards unstarted files in all waiting batches.
  const cancel = useCallback(() => controllers.current.forEach((c) => c.abort()), []);

  const value = useMemo(() => ({ add, cancel, status }), [add, cancel, status]);
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}
