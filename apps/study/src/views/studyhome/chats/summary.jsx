import { MessageSquare } from "lucide-react";
import "./chat.css";

// How a chat is summed up wherever chats are listed: the sidebar, the Chats screen and the
// Latest chats widget.

const DAY = 86400e3;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "now", "12m", "2h", a weekday within the last 7 days, then "20 Oct".
export function relativeTime(ms, now = Date.now()) {
  const ago = now - ms;
  if (ago < 60e3) return "now";
  if (ago < 3600e3) return `${Math.floor(ago / 60e3)}m`;
  if (ago < DAY) return `${Math.floor(ago / 3600e3)}h`;
  const date = new Date(ms);
  return ago < 7 * DAY ? WEEKDAYS[date.getDay()] : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// A chat's `updated` is an ISO time (or already milliseconds).
export const msOf = (updated) => (typeof updated === "number" ? updated : new Date(updated).getTime());

// Every chat, newest first.
export const chatsByTime = (chats = []) => [...chats].sort((a, b) => msOf(b.updated) - msOf(a.updated));

export const titleOf = (chat) => chat.title || "Untitled chat";

// The first 80 characters of Kratt's last answer.
const lastAnswer = (chat) => {
  const turn = chat.turns?.findLast((t) => t.who === "kratt");
  return turn ? turn.text.replace(/\s+/g, " ").trim().slice(0, 80) : "";
};

// One chat's title, the start of its last answer and its time. The Chats screen adds actions
// beside it; the Latest chats widget shows it alone.
export function ChatSummary({ chat, now }) {
  const answer = lastAnswer(chat);
  return (
    <>
      <MessageSquare size={14} className="st-list-icon" aria-hidden="true" />
      <span className="st-chats-text">
        <span className="st-chats-title st-truncate">{titleOf(chat)}</span>
        {answer && <span className="st-chats-answer st-truncate">{answer}</span>}
      </span>
      <span className="st-chats-time">{relativeTime(msOf(chat.updated), now)}</span>
    </>
  );
}
