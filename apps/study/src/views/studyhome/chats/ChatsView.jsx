import { useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import Dialog from "../dialogs/Dialog";
import { ChatSummary, chatsByTime, titleOf } from "./summary";
import "./chat.css";

const matches = (chat, query) =>
  titleOf(chat).toLowerCase().includes(query) || (chat.turns ?? []).some((t) => t.text.toLowerCase().includes(query));

function RenameInput({ chat, onDone }) {
  const done = (e, save) => onDone(save ? e.currentTarget.value : null);
  return (
    <input
      className="st-chats-rename"
      aria-label="Chat title"
      defaultValue={chat.title}
      autoFocus
      onBlur={(e) => done(e, true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(e, true);
        if (e.key === "Escape") done(e, false);
      }}
    />
  );
}

// The Chats screen (route `chats`): every chat, a search over titles and turns, and Open,
// Rename and Delete on each row.
export default function ChatsView() {
  const { state, actions } = useStudy();
  const shell = useShell();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const all = chatsByTime(state.chats);
  const q = query.trim().toLowerCase();
  const chats = q ? all.filter((c) => matches(c, q)) : all;
  const now = Date.now();

  return (
    <section className="st-page st-chats" aria-label="Chats">
      <h1 className="st-page-title">Chats</h1>
      {all.length === 0 ? (
        <p className="st-empty">No chats yet. Start one with New chat or Ctrl J.</p>
      ) : (
        <>
          <input
            type="search"
            className="st-chats-search"
            aria-label="Search chats"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {chats.length === 0 && <p className="st-empty">No chats match</p>}
          <ul className="st-list st-chats-list">
            {chats.map((chat) => (
              <li key={chat.id} className="st-chats-row">
                {renaming === chat.id ? (
                  <RenameInput
                    chat={chat}
                    onDone={(title) => {
                      if (title !== null) actions.renameChat(chat.id, title);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button className="st-list-row st-chats-main" tabIndex={-1} onClick={() => shell.chat?.open(chat.id)}>
                    <ChatSummary chat={chat} now={now} />
                  </button>
                )}
                <span className="st-chats-actions">
                  <button className="st-ghost-button" aria-label={`Open ${titleOf(chat)}`} onClick={() => shell.chat?.open(chat.id)}>
                    Open
                  </button>
                  <button className="st-ghost-button" aria-label={`Rename ${titleOf(chat)}`} onClick={() => setRenaming(chat.id)}>
                    Rename
                  </button>
                  <button className="st-ghost-button" aria-label={`Delete ${titleOf(chat)}`} onClick={() => setDeleting(chat)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {deleting && (
        <Dialog title="Delete chat" onCancel={() => setDeleting(null)}>
          <p className="st-dialog-text">Are you sure you want to delete "{titleOf(deleting)}"?</p>
          <div className="st-chats-dialog-actions">
            <button className="st-ghost-button" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className="st-danger-button"
              onClick={() => {
                actions.deleteChat(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
