import Dialog, { Choice } from "./Dialog";
import { useStudy } from "../data/StudyProvider";
import { deletionSummary } from "../data/operations";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The options depend on what's being deleted:
// - a page in one folder: delete it
// - a page linked into several folders: take it out of this one, or delete it everywhere
// - a folder: delete only the folder (its contents move up), or everything inside
// - a subject: delete only the subject (its contents go to Unsorted), or everything inside
export default function DeleteDialog({ id, parentId, onDone }) {
  const { state, parents, actions } = useStudy();
  const node = state.nodes[id];
  const finish = (fn) => () => {
    fn();
    onDone();
  };

  if (node.type === "page") {
    const places = parents[id] ?? [];
    const others = places.filter((p) => p !== parentId);
    return (
      <Dialog title={`Delete "${node.name}"?`} onCancel={onDone}>
        {others.length > 0 && parentId && (
          <Choice
            title={`Remove from "${state.nodes[parentId].name}"`}
            description={`The page stays in ${others.map((p) => `"${state.nodes[p].name}"`).join(", ")}.`}
            onClick={finish(() => actions.removeFromFolder(id, parentId))}
          />
        )}
        <Choice
          danger
          title={others.length > 0 ? "Delete everywhere" : "Delete page"}
          description="The page and everything written on it are deleted."
          onClick={finish(() => actions.deletePage(id))}
        />
        <button className="st-ghost-button st-dialog-cancel" onClick={onDone}>Cancel</button>
      </Dialog>
    );
  }

  const summary = deletionSummary(state, id);
  const inside = [summary.folders && plural(summary.folders, "folder"), summary.pages && plural(summary.pages, "page")]
    .filter(Boolean)
    .join(" and ");
  const survivors = summary.survivors
    ? ` ${plural(summary.survivors, "page")} also linked in other folders will stay there.`
    : "";

  return (
    <Dialog title={`Delete "${node.name}"?`} onCancel={onDone}>
      {node.type === "folder" && (
        <Choice
          title="Delete only the folder"
          description={
            summary.direct
              ? `Its ${plural(summary.direct, "item")} move up into "${state.nodes[parentId].name}".`
              : "The folder is empty."
          }
          onClick={finish(() => actions.deleteFolderKeepContents(id, parentId))}
        />
      )}
      {node.type === "subject" && summary.direct > 0 && (
        <Choice
          title="Delete only the subject"
          description={`Its ${plural(summary.direct, "item")} move to Unsorted.`}
          onClick={finish(() => actions.deleteSubjectKeepContents(id))}
        />
      )}
      {(node.type === "subject" || summary.direct > 0) && (
        <Choice
          danger
          title={node.type === "subject" ? (summary.direct ? "Delete subject and everything inside" : "Delete subject") : "Delete folder and everything inside"}
          description={(inside ? `This deletes ${inside}.` : "It's empty.") + survivors}
          onClick={finish(() => actions.deleteContainerAndContents(id))}
        />
      )}
      <button className="st-ghost-button st-dialog-cancel" onClick={onDone}>Cancel</button>
    </Dialog>
  );
}
