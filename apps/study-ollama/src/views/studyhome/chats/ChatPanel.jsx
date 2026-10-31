import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, History, Plus, SquarePen, X } from "lucide-react";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { newId } from "../data/operations";
import { allPages } from "../data/tree";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../ui/dropdown-menu";
import Kratt from "../kratt/Kratt";
import { CHAT_MESSAGES, ChatError, buildPrompt, citationsIn, createChatService, gatherContext } from "./chatService";
import { chatTitle, escapeHeadings } from "./format";
import "./chat.css";

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const CONNECTED = "Open Notebook connected. Chats save to your Study folder.";
const LOCAL_CONNECTED = "Answered on this computer. Chats save to your Study folder.";
// Errors where Ollama itself isn't there, as opposed to a model that needs picking.
const OLLAMA_DOWN = new Set(["ollama-missing", "ollama-failed", "ollama-unavailable"]);
const QUIZ = "Quiz me on this, 5 questions";

// An error's first sentence, for the status line.
const shortForm = (message) => String(message).split(/(?<=\.)\s/)[0];

// Dragging the panel's left edge resizes it; `width` and `onWidth` keep the size in Settings.
function useResize(width, onWidth) {
  const [dragWidth, setDragWidth] = useState(null);
  const start = useRef(null);
  const current = dragWidth ?? width;
  const handlers = {
    onPointerDown: (e) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, width: current };
    },
    onPointerMove: (e) => {
      if (!start.current) return;
      const next = start.current.width + (start.current.x - e.clientX);
      setDragWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    },
    onPointerUp: () => {
      if (!start.current) return;
      start.current = null;
      if (dragWidth !== null) onWidth(dragWidth);
      setDragWidth(null);
    },
  };
  return { current, resizing: dragWidth !== null, handlers };
}

// The chat title; clicking it renames the chat.
function ChatTitle({ chat, onRename }) {
  const [editing, setEditing] = useState(false);
  if (!chat) return <span className="st-chat-title st-truncate">New chat</span>;
  if (!editing) {
    return (
      <button className="st-chat-title st-truncate" onClick={() => setEditing(true)} title="Rename chat">
        {chat.title}
      </button>
    );
  }
  const done = (e, save) => {
    if (save) onRename(e.currentTarget.value);
    setEditing(false);
  };
  return (
    <input
      className="st-chat-title-input"
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

// The Kratt Chat panel on the right. The shell owns which chat is open: `chatId` (null for a new
// chat), `session` (bumped each time a chat is opened or a new one started) and `onChatId`, which
// adopts the chat a first question creates. `address`, `local` and `memory` come from Settings > AI.
export default function ChatPanel({ open, onClose, width, onWidth, chatId, session, onChatId, address, local = false, memory }) {
  const { state, actions, client, vault } = useStudy();
  const shell = useShell();
  const { current, resizing, handlers } = useResize(width, onWidth);
  const addressRef = useRef(address);
  addressRef.current = address;
  const localRef = useRef(local);
  localRef.current = local;
  const service = useMemo(
    () => createChatService({ client, address: () => addressRef.current, local: () => localRef.current }),
    [client]
  );
  const chat = chatId ? state.chats.find((c) => c.id === chatId) ?? null : null;

  const [draft, setDraft] = useState("");
  const [draftContext, setDraftContext] = useState(null); // a new chat's pills, once changed
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null); // { chatId, code, message }
  const [earlier, setEarlier] = useState(null); // { chatId, at }: the oldest turn sent
  const [status, setStatus] = useState(null);
  const box = useRef(null);

  // Opening a chat or starting a new one forgets the last one's notices.
  const [seenSession, setSeenSession] = useState(session);
  if (session !== seenSession) {
    setSeenSession(session);
    setError(null);
    setEarlier(null);
    setDraftContext(null);
  }
  useEffect(() => {
    if (open && session) box.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const route = shell.route;
  const routePage = route?.view === "node" && state.nodes[route.id]?.type === "page" ? route.id : null;
  const context = (chat ? chat.context : draftContext ?? (routePage ? [routePage] : [])).filter((id) => state.nodes[id]);
  const setContext = (next) => (chat ? actions.setChatContext(chat.id, next) : setDraftContext(next));
  const contextPage = context.map((id) => state.nodes[id]).find((n) => n.type === "page");
  const labelOf = (id) => (id === routePage ? "This page" : state.nodes[id].name);
  const addable = [
    ...state.subjects.map((id) => state.nodes[id]).filter(Boolean),
    ...allPages(state).sort((a, b) => a.name.localeCompare(b.name)),
  ].filter((n) => !context.includes(n.id));

  // Shows the error on the chat's card. Anything that isn't a ChatError is a bug in the app,
  // not Open Notebook's fault, so it gets the generic card and goes to the console.
  const fail = (id, e) => {
    if (!(e instanceof ChatError)) {
      console.error(e);
      e = new ChatError("app-error", CHAT_MESSAGES["app-error"]);
    }
    setError({ chatId: id, code: e.code, message: e.message });
    setStatus(shortForm(e.message));
  };

  const ask = async ({ id, question, turns, ids }) => {
    setPending(true);
    setError(null);
    try {
      const { answer, sentFrom } = await service.ask({ question, context: gatherContext(state, ids), turns, memory });
      actions.appendTurn(id, { who: "kratt", text: escapeHeadings(answer) }, Date.now());
      setEarlier(sentFrom > 0 ? { chatId: id, at: sentFrom } : null);
      setStatus(localRef.current ? LOCAL_CONNECTED : CONNECTED);
    } catch (e) {
      fail(id, e);
    } finally {
      setPending(false);
    }
  };

  // Saves the question (creating the chat on the first one), then asks.
  const sendQuestion = (text, { fromComposer = false } = {}) => {
    const question = text.trim();
    if (!question || pending) return;
    try {
      buildPrompt({ question, context: [], turns: [], memory }); // too long even on its own?
    } catch (e) {
      fail(chatId, e);
      return;
    }
    let id = chat?.id;
    if (!id) {
      id = actions.addChat({ id: newId(), title: chatTitle(question), context, now: Date.now() });
      onChatId(id);
    }
    const turns = chat?.turns ?? [];
    actions.appendTurn(id, { who: "you", text: escapeHeadings(question) }, Date.now());
    if (fromComposer) setDraft("");
    ask({ id, question, turns, ids: context });
  };

  // Re-asks the last question, which has no answer after it, without saving it again.
  const last = chat?.turns.at(-1);
  const canRetry = Boolean(chat && last?.who === "you" && !pending);
  const retry = () => canRetry && ask({ id: chat.id, question: last.text, turns: chat.turns.slice(0, -1), ids: context });

  const shownError = error && error.chatId === chatId ? error : null;
  const earlierAt = earlier && earlier.chatId === chatId ? earlier.at : null;
  const offline = vault?.offline;
  const statusText = offline ? CHAT_MESSAGES.offline : status;
  const turns = chat?.turns ?? [];

  const earlierLine = (
    <p key="earlier" className="st-chat-earlier">
      Earlier messages aren't sent with new questions.{" "}
      <button className="st-chat-link" onClick={() => shell.openSettings("ai")}>
        Chat memory
      </button>
    </p>
  );

  const renderTurn = (turn, i) => {
    if (turn.who === "you") {
      return (
        <div key={i} className="st-chat-me">
          {turn.text}
        </div>
      );
    }
    const cites = citationsIn(turn.text, state);
    return (
      <div key={i} className="st-chat-turn">
        <div className="st-chat-who">
          <Kratt size={20} />
          Kratt
        </div>
        <div className="st-chat-bot">{turn.text}</div>
        {cites.length > 0 && (
          <div className="st-chat-cites">
            {cites.map((c) => (
              <button key={c.id} className="st-chat-cite" onClick={() => shell.open({ view: "node", id: c.id })}>
                {c.title}
              </button>
            ))}
          </div>
        )}
        <div className="st-chat-actions">
          <button className="st-chat-quiet" disabled={pending || offline} onClick={() => sendQuestion(QUIZ)}>
            Quiz me
          </button>
          <button
            className="st-chat-quiet"
            onClick={() => {
              actions.addQuickNote(`${turn.text}\n\nFrom Kratt Chat: ${chat.title}`);
              shell.toast?.("Saved to Notes");
            }}
          >
            Save as note
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside
      className="st-ai"
      aria-label="Kratt Chat"
      aria-hidden={!open}
      inert={!open}
      data-open={open || undefined}
      data-resizing={resizing || undefined}
      style={{ width: open ? current : 0 }}
    >
      <div className="st-ai-resize" role="separator" aria-orientation="vertical" aria-label="Resize Kratt Chat" {...handlers} />
      <div className="st-ai-inner" style={{ width: current }}>
        <div className="st-ai-head">
          <ChatTitle key={chat?.id} chat={chat} onRename={(title) => actions.renameChat(chat.id, title)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="st-icon-button" aria-label="Chat history">
                <History size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {state.chats.length === 0 && <DropdownMenuLabel>No chats yet</DropdownMenuLabel>}
              {state.chats.slice(0, 10).map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => shell.chat?.open(c.id)}>
                  {c.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="st-icon-button" aria-label="New chat" onClick={() => shell.chat?.newChat()}>
            <SquarePen size={16} />
          </button>
          <button className="st-icon-button" aria-label="Close Kratt Chat" onClick={onClose}>
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="st-chat-ctx">
          {context.map((id) => (
            <span key={id} className="st-chat-pill">
              {labelOf(id)}
              <button aria-label={`Remove ${labelOf(id)}`} onClick={() => setContext(context.filter((x) => x !== id))}>
                <X size={12} />
              </button>
            </span>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="st-chat-pill" aria-label="Add context">
                <Plus size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="st-chat-picker">
              {addable.length === 0 && <DropdownMenuLabel>Nothing more to add</DropdownMenuLabel>}
              {addable.map((n) => (
                <DropdownMenuItem key={n.id} onSelect={() => setContext([...context, n.id])}>
                  {n.name}
                  {n.type === "subject" && <span className="st-faint"> · subject</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="st-chat-msgs" aria-live="polite">
          {turns.length === 0 && (
            <div className="st-chat-empty">
              <div className="st-chat-hello">
                <Kratt size={72} label="Kratt" />
                <span className="st-chat-hi">Hi, I'm Kratt.</span>
                <span className="st-chat-soft">Ask me about this page or anything in your notes. I'll show which notes each answer came from.</span>
              </div>
              {contextPage && (
                <div className="st-chat-sugg">
                  {["Explain this page in 5 steps", `Quiz me on ${contextPage.name}`].map((s) => (
                    <button key={s} disabled={pending || offline} onClick={() => sendQuestion(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {turns.flatMap((turn, i) => (i === earlierAt ? [earlierLine, renderTurn(turn, i)] : [renderTurn(turn, i)]))}
          {earlierAt !== null && earlierAt >= turns.length && earlierLine}
          {pending && (
            <div className="st-chat-who">
              <Kratt size={20} mode="think" />
              Kratt is thinking
            </div>
          )}
          {shownError && (
            <div className="st-chat-warn" role="alert">
              {shownError.code === "ai-unavailable" && (
                <span className="st-chat-warn-head">
                  <Kratt size={44} mode="sleep" label="Kratt is asleep" />
                  <span>Kratt can't reach Open Notebook at {address}.</span>
                </span>
              )}
              {OLLAMA_DOWN.has(shownError.code) && (
                <span className="st-chat-warn-head">
                  <Kratt size={44} mode="sleep" label="Kratt is asleep" />
                  <span>Kratt can't run the AI on this computer.</span>
                </span>
              )}
              <span className="st-chat-soft">{shownError.message}</span>
              <div className="st-chat-actions">
                {canRetry && shownError.code !== "too-long" && (
                  <button className="st-button" onClick={retry}>
                    Try again
                  </button>
                )}
                <button className="st-chat-quiet" onClick={() => shell.openSettings("ai")}>
                  Open settings
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="st-chat-compose">
          <div className="st-chat-box">
            <textarea
              ref={box}
              aria-label="Message"
              placeholder="Ask Kratt"
              rows={2}
              value={draft}
              // Read-only, not disabled, while Kratt answers: disabling drops the focus.
              readOnly={pending}
              disabled={offline}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                sendQuestion(draft, { fromComposer: true });
              }}
            />
            <button
              className="st-button"
              aria-label="Send"
              disabled={pending || offline || !draft.trim()}
              onClick={() => sendQuestion(draft, { fromComposer: true })}
            >
              Send
            </button>
          </div>
          {statusText && (
            <p className="st-chat-status">
              <span className="st-chat-dot" data-ok={statusText === CONNECTED || undefined} aria-hidden="true" />
              {statusText}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
