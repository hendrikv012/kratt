import { FilePlus, FileText, Folder, FolderPlus, Link2 } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { homeOf } from "../data/tree";
import TitleInput from "./TitleInput";
import Breadcrumb from "../shell/Breadcrumb";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const KIND = { subject: "Subject", folder: "Folder", unsorted: "Not in any subject" };

// A subject or folder: its name and what's inside it.
export default function ContainerView({ id, fresh = false }) {
  const { state, parents, actions } = useStudy();
  const shell = useShell();
  const node = state.nodes[id];

  const create = (type) => {
    const newId = actions.addChild(id, type);
    if (type === "page") shell.open({ view: "node", id: newId });
    else shell.startRename(newId);
  };

  return (
    <article className="st-page">
      <Breadcrumb id={id} />
      <TitleInput id={id} autoFocus={fresh} />
      <div className="st-page-meta">
        {node.type === "subject" && <span className="st-subject-mark" style={{ background: node.color }} aria-hidden="true" />}
        <span>{KIND[node.type]}, {plural(node.children.length, "item")}</span>
      </div>

      {node.type === "unsorted" && node.children.length > 0 && (
        <p className="st-empty">Drag these onto a subject or folder in the sidebar to sort them.</p>
      )}
      {node.children.length === 0 ? (
        <p className="st-empty">Nothing here yet. Add a folder to organise, or a page to start writing.</p>
      ) : (
        <ul className="st-item-list">
          {node.children.map((childId, i) => {
            const child = state.nodes[childId];
            const linked = child.type === "page" && homeOf(state, parents, childId) !== id;
            return (
              <li key={childId} className="st-fx-row" style={{ "--i": i }}>
                <button
                  className="st-item-row"
                  onClick={() => shell.open({ view: "node", id: childId, via: linked ? id : undefined })}
                >
                  {child.type === "folder" ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                  <span className="st-truncate">{child.name}</span>
                  {linked && (
                    <span className="st-faint st-small st-item-note">
                      <Link2 size={12} aria-hidden="true" /> Lives in {state.nodes[homeOf(state, parents, childId)].name}
                    </span>
                  )}
                  {child.type === "folder" && (
                    <span className="st-faint st-small st-item-note">{plural(child.children.length, "item")}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="st-row" style={{ marginTop: 16 }}>
        <button className="st-ghost-button st-outline" onClick={() => create("folder")}>
          <FolderPlus size={15} aria-hidden="true" /> New folder
        </button>
        <button className="st-ghost-button st-outline" onClick={() => create("page")}>
          <FilePlus size={15} aria-hidden="true" /> New page
        </button>
      </div>
    </article>
  );
}
