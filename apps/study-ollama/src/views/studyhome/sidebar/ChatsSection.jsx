import { MessageSquare } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { chatsByTime, msOf, relativeTime } from "../chats/summary";

export default function ChatsSection() {
  const { state } = useStudy();
  const shell = useShell();
  const chats = chatsByTime(state.chats).slice(0, 3);
  const now = Date.now();
  return (
    <>
      <div className="st-side-section st-side-section-row">
        <span>Chats</span>
        <button className="st-side-link" onClick={() => shell.open({ view: "chats" })}>
          See all
        </button>
      </div>
      {chats.length === 0 ? (
        <p className="st-side-empty">No chats yet</p>
      ) : (
        chats.map((chat) => (
          <button key={chat.id} className="st-side-row" onClick={() => shell.chat?.open?.(chat.id)}>
            <MessageSquare size={14} aria-hidden="true" />
            <span className="st-side-text">{chat.title || "Untitled chat"}</span>
            <span className="st-side-meta">{relativeTime(msOf(chat.updated), now)}</span>
          </button>
        ))
      )}
    </>
  );
}
