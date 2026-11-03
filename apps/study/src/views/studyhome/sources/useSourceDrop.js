import { useEffect, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { UNSORTED } from "../data/tree";
import { intakeFrom } from "./intake";
import { useUploads } from "./UploadsProvider";
import { dropAction, dropMessage } from "./groups";

const MIME = "application/x-study-source";
const editable = (target) => target?.closest?.("input, textarea, select, [contenteditable], dialog, [role=dialog]");
export default function useSourceDrop(subjectId) {
  const { state, actions } = useStudy();
  const { toast } = useShell();
  const uploads = useUploads();
  const [overId, setOverId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const reset = () => { setOverId(null); setDragging(false); };
  const accept = (promise, target) => promise.then((intake) => uploads.add(intake, target === UNSORTED ? null : target)).catch((error) => toast?.(error.message));
  useEffect(() => {
    const paste = (event) => {
      if (editable(event.target) || document.querySelector('[role="dialog"], dialog[open]')) return;
      const transfer = event.clipboardData;
      if (!transfer) return;
      const text = transfer.getData("text/plain") || transfer.getData("text/uri-list");
      if (!/https?:\/\//i.test(text)) return;
      event.preventDefault();
      accept(intakeFrom(transfer).then((intake) => ({ ...intake, files: [] })), subjectId || UNSORTED);
    };
    const escape = (event) => { if (event.key === "Escape") reset(); };
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", escape);
    window.addEventListener("dragend", reset);
    return () => { window.removeEventListener("paste", paste); window.removeEventListener("keydown", escape); window.removeEventListener("dragend", reset); };
  }, [subjectId, uploads, toast]);

  const dropProps = (target = subjectId || UNSORTED) => ({
    onDragOver(event) {
      if (editable(event.target)) return;
      const types = Array.from(event.dataTransfer?.types || []);
      if (!types.some((type) => [MIME, "Files", "text/uri-list", "text/plain"].includes(type))) return;
      event.preventDefault(); event.stopPropagation(); setOverId(target);
    },
    onDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) setOverId(null); },
    onDrop(event) {
      if (editable(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      const transfer = event.dataTransfer;
      const internal = transfer.getData(MIME);
      reset();
      if (internal) {
        let drag; try { drag = JSON.parse(internal); } catch { return; }
        if (!state.sources.some((s) => s.id === drag.id)) return;
        const action = dropAction(state, drag.id, drag.from, target, event.ctrlKey || event.altKey);
        if (action.type === "move") actions.moveSourceToSubject(drag.id, action.fromId, action.subjectId);
        else if (action.type === "add") actions.addSourceToSubject(drag.id, action.subjectId);
        else if (action.type === "remove") actions.removeSourceFromSubject(drag.id, action.subjectId);
        const message = dropMessage(action, state); if (message) toast?.(message);
      } else {
        // Capture protected DataTransfer contents now, before any async directory walk.
        accept(intakeFrom(transfer), target);
      }
    },
  });
  const dragProps = (source, from) => ({
    draggable: true,
    onDragStart(event) { setDragging(true); event.dataTransfer.setData(MIME, JSON.stringify({ id: source.id, from })); event.dataTransfer.effectAllowed = "copyMove"; },
    onDragEnd: reset,
  });
  return { dropProps, dragProps, overId, dragging };
}
