import { useLayoutEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { useStudy } from "../data/StudyProvider";
import { useShell } from "../ShellContext";
import { newId } from "../data/operations";
import Kratt from "../kratt/Kratt";
import { CHAT_MESSAGES, ChatError, createChatService, gatherContext } from "../chats/chatService";
import { chatTitle, escapeHeadings } from "../chats/format";
import "./ask-kratt.css";

// Answers are Markdown from Open Notebook. Any HTML in them shows as text, so an answer can't add
// images, links or markup of its own to the note.
const markdown = new MarkdownIt({ html: false, linkify: false });
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Kratt's answer as a quote in the note, headed with the question, so it's clear what it answers
// and easy to keep or delete. It saves as plain Markdown ("> **Kratt** · question").
const answerBlock = (question, answer) =>
  `<blockquote><p><strong>Kratt</strong> · ${escapeHtml(question)}</p>${markdown.render(answer)}</blockquote>`;

// Puts the answer where /Kratt was typed: in place of the empty line, or after the line it's on.
function insertAnswer(editor, at, html) {
  const { doc } = editor.state;
  const $at = doc.resolve(Math.min(at, doc.content.size));
  const block = $at.depth > 0 ? $at.node($at.depth) : null;
  const chain = editor.chain().focus();
  if (block && block.isTextblock && block.content.size === 0) {
    chain.insertContentAt({ from: $at.before($at.depth), to: $at.after($at.depth) }, html);
  } else {
    chain.insertContentAt($at.depth > 0 ? $at.after(1) : at, html);
  }
  chain.run();
}

// Where the box goes: under the line the cursor is on.
function placeAt(editor, at) {
  try {
    const c = editor.view.coordsAtPos(at);
    return { top: c.bottom + 6, left: c.left };
  } catch {
    return null;
  }
}

// The box /Kratt opens in a note: ask about the note, get the answer into it, and carry on in
// Kratt Chat if there's more to ask.
export default function AskKratt({ editor, pageId, onClose }) {
  const { state, actions, client } = useStudy();
  const shell = useShell();
  const at = useRef(editor.state.selection.from).current;
  const [place, setPlace] = useState(null);
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState("asking"); // asking | thinking | answered | failed
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const asked = useRef(0); // the current ask; a closed box ignores a late answer
  const settings = useRef(shell.chat);
  settings.current = shell.chat;
  const service = useMemo(() => createChatService({ client, address: () => settings.current?.address }), [client]);

  useLayoutEffect(() => setPlace(placeAt(editor, at)), [editor, at]);

  const close = () => {
    asked.current++;
    onClose();
    if (!editor.isDestroyed) editor.commands.focus();
  };

  const send = async () => {
    const q = question.trim();
    if (!q || phase === "thinking") return;
    const id = ++asked.current;
    setPhase("thinking");
    setError(null);
    try {
      const reply = await service.ask({
        question: q,
        context: gatherContext(state, [pageId]),
        turns: [],
        memory: settings.current?.memory,
      });
      if (id !== asked.current || editor.isDestroyed) return;
      insertAnswer(editor, at, answerBlock(q, reply.answer));
      setAnswer({ question: q, text: reply.answer });
      setPhase("answered");
    } catch (e) {
      if (id !== asked.current) return;
      if (!(e instanceof ChatError)) console.error(e);
      setError(e instanceof ChatError ? e.message : CHAT_MESSAGES["app-error"]);
      setPhase("failed");
    }
  };

  const continueInChat = () => {
    const now = Date.now();
    const chatId = actions.addChat({ id: newId(), title: chatTitle(answer.question), context: [pageId], now });
    actions.appendTurn(chatId, { who: "you", text: escapeHeadings(answer.question) }, now);
    actions.appendTurn(chatId, { who: "kratt", text: escapeHeadings(answer.text) }, now);
    shell.chat?.open(chatId);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="st-ask" role="dialog" aria-label="Ask Kratt" style={place ?? undefined} onKeyDown={onKeyDown}>
      <div className="st-ask-row">
        <Kratt size={20} mode={phase === "thinking" ? "thinking" : "idle"} />
        {phase === "answered" ? (
          <span className="st-ask-note">Kratt's answer is in your note.</span>
        ) : (
          <input
            className="st-ask-input"
            aria-label="Ask Kratt about this note"
            placeholder="Ask Kratt about this note…"
            autoFocus
            value={question}
            readOnly={phase === "thinking"}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
          />
        )}
      </div>
      {phase === "thinking" && <p className="st-ask-status">Kratt is thinking…</p>}
      {phase === "failed" && (
        <p className="st-ask-status st-ask-error" role="alert">
          {error}
        </p>
      )}
      <div className="st-ask-actions">
        {phase === "answered" && (
          <button className="st-ghost-button" onClick={continueInChat} autoFocus>
            Continue in chat
          </button>
        )}
        {phase === "failed" && (
          <button className="st-ghost-button" onClick={send}>
            Try again
          </button>
        )}
        <button className="st-ghost-button" onClick={close}>
          {phase === "answered" ? "Done" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
