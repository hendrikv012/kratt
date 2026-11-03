// Making an artifact: the prompt Kratt gets, the answer read back into items, one retry.
//
// The notes go in as parts that fit Chat memory. This is the path for one part; each part is
// prompt -> send -> parse -> one retry -> items (see makePart).

import { ChatError, INSTRUCTIONS, MEMORY, byteLength, cutToBytes } from "../chats/chatService";
import { chatTitle } from "../chats/format";
import { TYPE_LABELS, parseArtifact, problemsIn } from "./format";
import { splitIntoParts } from "./notes";

// How many items per byte of notes, and the least and most to ask for in one part.
export const TARGETS = {
  flashcards: { per: 400, min: 3, max: 15 },
  slides: { per: 800, min: 2, max: 10 },
  quiz: { per: 600, min: 2, max: 8 },
};

const WORDS = { flashcards: "cards", slides: "slides", quiz: "questions" };
const MADE_BYTES = 1024; // what the "already made" list may take, separators included
const RETRY_BYTES = 512; // what the retry's note about problems may add to a prompt
const RETRY_HEAD = "\n\nYour last answer had these problems:\n";
const RETRY_TAIL = "\nAnswer again, in exactly the format above.";

const FORMATS = {
  flashcards: `Each card is a "### " heading with the front, then the back as plain text:
### What is the powerhouse of the cell?
The mitochondrion.

### What does ATP stand for?
Adenosine triphosphate.`,
  slides: `Each slide starts with a "# " title line, then its text. Slides are separated by a line of three dashes:
# Cells
- The smallest unit of life
- Every living thing is made of them

---

# Mitochondria
- Make ATP
- Have their own DNA`,
  quiz: `Each question is a "### " heading, then 2 to 4 choices as "- [ ] " lines, with exactly one right choice marked "- [x] ", then a "> " line saying why it is right:
### Which organelle makes ATP?
- [ ] Nucleus
- [x] Mitochondrion
- [ ] Ribosome
> The mitochondrion runs the Krebs cycle.

### What does ATP stand for?
- [x] Adenosine triphosphate
- [ ] Atomic transfer protein
> ATP is the cell's energy carrier.`,
};

export const targetFor = (type, partBytes) => {
  const { per, min, max } = TARGETS[type];
  return Math.min(max, Math.max(min, Math.round(partBytes / per)));
};

// The newest entries that fit MADE_BYTES with their line breaks; one too long alone is cut.
function fitMade(made) {
  const kept = [];
  let used = 0;
  for (let i = made.length - 1; i >= 0; i--) {
    const line = cutToBytes(made[i], MADE_BYTES);
    const size = byteLength(line) + (kept.length ? 1 : 0);
    if (used + size > MADE_BYTES) break;
    kept.unshift(line);
    used += size;
  }
  return kept;
}

// The retry prompt: the same prompt plus the problems, as many lines as fit RETRY_BYTES.
export function retryPrompt(prompt, problems) {
  const room = RETRY_BYTES - byteLength(RETRY_HEAD + RETRY_TAIL);
  const lines = [];
  let used = 0;
  for (const problem of problems) {
    const line = `- ${problem}`;
    const size = byteLength(line) + 1;
    if (used + size > room - byteLength("- …") - 1) {
      lines.push("- …");
      break;
    }
    lines.push(line);
    used += size;
  }
  return prompt + RETRY_HEAD + lines.join("\n") + RETRY_TAIL;
}

export function buildArtifactPrompt({ type, partText, part, of, topic, made, target }) {
  const lines = [
    INSTRUCTIONS,
    "",
    `Make ${TYPE_LABELS[type].toLowerCase()} from the notes below, in exactly this format:`,
    FORMATS[type],
    "",
    `Make about ${target} ${WORDS[type]}. Cover everything in these notes.`,
  ];
  if (of > 1) {
    lines.push(`Part ${part} of ${of}. Don't repeat these, already made:`);
    if (made.length) lines.push(...fitMade(made));
  }
  lines.push(`Topic: ${topic}`, "# Notes", partText);
  return lines.join("\n");
}

// What every prompt costs before the notes: the longest "made" list and part numbers, and room for a retry's problems, as an upper bound.
export const fixedPromptBytes = (type, topic) =>
  RETRY_BYTES +
  byteLength(
    buildArtifactPrompt({ type, partText: "", part: Number.MAX_SAFE_INTEGER, of: Number.MAX_SAFE_INTEGER, topic, made: ["m".repeat(MADE_BYTES)], target: TARGETS[type].max })
  );

const normalize = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const KEY_OF = { flashcards: "front", quiz: "question" }; // slides are not deduped
const MADE_OF = { flashcards: (i) => i.front, slides: (i) => i.title, quiz: (i) => i.question };

const cancelled = () => new ChatError("cancelled", "");

// A leading "# Title" line names flashcards and a quiz and is taken off; for slides the first
// "# " line is the first slide's title, which stays.
function readAnswer(type, answer) {
  let body = String(answer ?? "");
  let title = "";
  if (type === "slides") {
    title = /^\s*#[ \t]+(.+)/.exec(body)?.[1].trim() ?? "";
  } else {
    const m = /^\s*#[ \t]+(.+)\n?/.exec(body);
    if (m) {
      title = m[1].trim();
      body = body.slice(m[0].length);
    }
  }
  return { title, items: parseArtifact(type, body) };
}

export function createArtifactMaker({ send }) {
  // One part: ask, read, and ask once more with the problems if it can't be used.
  async function makePart({ type, prompt, signal, part, of }) {
    let ask = prompt;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw cancelled();
      const answer = await send(ask);
      if (signal?.aborted) throw cancelled();
      const result = readAnswer(type, answer);
      const problems = problemsIn(type, result.items);
      if (!problems.length) return result;
      ask = retryPrompt(prompt, problems);
    }
    // A saved artifact covers all its notes, so one that is still wrong is not kept in part.
    const which = of > 1 ? `part ${part} of ${of} of ` : "";
    throw new ChatError("artifact-unreadable", `Kratt couldn't make ${which}these ${WORDS[type]}. Try again.`);
  }

  return {
    async make({ type, notes, topic, memory, onProgress, signal }) {
      const shownTopic = cutToBytes(topic?.trim() || notes.map((n) => n.title).join(", "), 400);
      const room = (MEMORY[memory] ?? MEMORY.normal) - fixedPromptBytes(type, shownTopic);
      const parts = splitIntoParts(notes, room);
      const sourceBytes = notes.reduce((sum, n) => sum + byteLength(n.markdown), 0);
      const of = Math.max(1, parts.length);
      const items = [];
      const seen = new Set();
      let name = "";
      for (let k = 1; k <= of; k++) {
        if (signal?.aborted) throw cancelled();
        onProgress?.({ part: k, of });
        const part = parts[k - 1] ?? { text: "" };
        const prompt = buildArtifactPrompt({
          type,
          partText: part.text,
          part: k,
          of,
          topic: shownTopic,
          made: items.map(MADE_OF[type]),
          target: targetFor(type, byteLength(part.text)),
        });
        const result = await makePart({ type, prompt, signal, part: k, of });
        if (k === 1) name = result.title || (topic?.trim() ? chatTitle(topic) : notes[0]?.title || chatTitle(""));
        let fresh = result.items;
        // A later part's deck often opens by repeating the title slide.
        if (type === "slides" && k > 1 && fresh.length && [name, topic].some((t) => t?.trim() && normalize(t) === normalize(fresh[0].title))) fresh = fresh.slice(1);
        for (const item of fresh) {
          const key = KEY_OF[type] ? normalize(item[KEY_OF[type]]) : null;
          if (key !== null) {
            if (seen.has(key)) continue;
            seen.add(key);
          }
          items.push(item);
        }
      }
      return { title: name, items, parts: of, sourceBytes };
    },
  };
}
