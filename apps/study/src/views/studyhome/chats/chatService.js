// Asking Kratt: what goes into a prompt, how much of it fits, and what comes back.
//
// Chat memory (Settings > AI) is the budget, in bytes of UTF-8, for the whole prompt:
// instructions, notes, earlier turns and the question. The question always goes in; the notes
// get at most half of what is left, and the earlier turns the rest, newest first.

import { pageMarkdown } from "../data/vaultState";
import { allPages, pagesInside } from "../data/tree";
import { VaultOffline } from "../data/vaultClient";
import { LOCAL_MESSAGES, isLocalError } from "../ai/localAi";

export const MEMORY = { short: 8192, normal: 24576, long: 49152 };
const LABELS = { short: "Short", normal: "Normal", long: "Long" };
const SUBJECT_PAGE_BYTES = 2048; // what a subject gives of each of its pages

export const INSTRUCTIONS =
  "You are Kratt, a study helper. Answer from the notes given when you can. When you use a note, cite it as [[Title]]. Say so when the notes don't cover the question.";

export class ChatError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ChatError";
    this.code = code;
  }
}

export const CHAT_MESSAGES = {
  "ai-unavailable": (address) => `Kratt's engine isn't answering at ${address}. Start Kratt's engine, or change the address in Settings > AI.`,
  "ai-auth": "Kratt's engine didn't accept the password. Check it in Settings > AI.",
  "app-error": "Something went wrong in Kratt Chat. Try again, or restart the app if it keeps happening.",
  offline: "Chats need the Study folder service. Start it with `memory-engine serve`.",
  "too-long": (memory) =>
    `That question is too long for Chat memory: ${LABELS[memory] ?? memory}. Shorten it, or pick a longer Chat memory in Settings > AI.`,
};

const encoder = new TextEncoder();
const bytes = (s) => encoder.encode(s).length;

// The first `limit` bytes of a text, without splitting a character.
function cutToBytes(text, limit) {
  const encoded = encoder.encode(text);
  if (encoded.length <= limit) return text;
  return new TextDecoder().decode(encoded.slice(0, limit)).replace(/�+$/, "");
}

// The notes a question is asked with: a page gives all of itself, a subject the start of each page.
export function gatherContext(state, ids) {
  const items = [];
  for (const id of ids) {
    const node = state.nodes[id];
    if (!node) continue;
    if (node.type === "page") items.push({ title: node.name, markdown: pageMarkdown(node) });
    else if (node.type === "subject") {
      for (const pageId of pagesInside(state, id)) {
        const page = state.nodes[pageId];
        items.push({ title: page.name, markdown: cutToBytes(pageMarkdown(page), SUBJECT_PAGE_BYTES) });
      }
    }
  }
  return items;
}

// Items in order, each as "## [[Title]]\n<markdown>\n"; one that doesn't fit whole is cut at the
// last blank line that fits, and skipped when none does.
function fitContext(context, budget) {
  let text = "";
  for (const { title, markdown } of context) {
    const head = `## [[${title}]]\n`;
    const left = budget - bytes(text);
    let item = `${head}${markdown}\n`;
    if (bytes(item) > left) {
      item = null;
      for (let at = markdown.lastIndexOf("\n\n"); at > 0; at = markdown.lastIndexOf("\n\n", at - 1)) {
        const cut = `${head}${markdown.slice(0, at)}\n`;
        if (bytes(cut) <= left) {
          item = cut;
          break;
        }
      }
    }
    if (item) text += item;
  }
  return text;
}

const turnLine = (turn) => `${turn.who === "kratt" ? "Kratt" : "You"}: ${turn.text}\n`;

// sentFrom: the index in `turns` of the oldest turn sent (turns.length when none is).
export function buildPrompt({ question, context, turns, memory }) {
  const limit = MEMORY[memory] ?? MEMORY.normal;
  const opening = `${INSTRUCTIONS}\n\n# Notes\n`;
  const middle = "\n# Conversation\n";
  const closing = `\nYou: ${question}\nKratt:`;
  const budget = limit - bytes(opening) - bytes(middle) - bytes(closing);
  if (budget < 0) throw new ChatError("too-long", CHAT_MESSAGES["too-long"](memory));

  const notes = fitContext(context, Math.floor(budget / 2));
  let left = budget - bytes(notes);
  let sentFrom = turns.length;
  let kept = "";
  for (let i = turns.length - 1; i >= 0; i--) {
    const line = turnLine(turns[i]);
    if (bytes(line) > left) break;
    left -= bytes(line);
    kept = line + kept;
    sentFrom = i;
  }
  return { prompt: opening + notes + middle + kept + closing, sentFrom };
}

// The pages an answer cites with [[Title]], matched to page names ignoring case.
export function citationsIn(answer, state) {
  const byName = new Map();
  for (const page of allPages(state)) {
    const key = page.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, page);
  }
  const found = [];
  const seen = new Set();
  for (const [, title] of String(answer ?? "").matchAll(/\[\[([^\]]+)\]\]/g)) {
    const page = byName.get(title.trim().toLowerCase());
    if (!page || seen.has(page.id)) continue;
    seen.add(page.id);
    found.push({ id: page.id, title: page.name });
  }
  return found;
}

// address() returns the Open Notebook address from settings and local() whether the AI runs on
// this computer (then Ollama answers, through the service), both read at each ask.
export function createChatService({ client, address, local = () => false }) {
  return {
    async ask({ question, context, turns, memory }) {
      const { prompt, sentFrom } = buildPrompt({ question, context, turns, memory });
      const onComputer = local();
      try {
        const { output } = onComputer ? await client.localAsk(prompt) : await client.notebookAsk(address(), prompt);
        return { answer: output, sentFrom };
      } catch (error) {
        if (error instanceof VaultOffline) throw new ChatError("offline", CHAT_MESSAGES.offline);
        if (onComputer) {
          const code = isLocalError(error?.message) ? error.message : "ollama-unavailable";
          throw new ChatError(code, LOCAL_MESSAGES[code]);
        }
        if (error?.message === "ai-auth") throw new ChatError("ai-auth", CHAT_MESSAGES["ai-auth"]);
        throw new ChatError("ai-unavailable", CHAT_MESSAGES["ai-unavailable"](address()));
      }
    },
  };
}
