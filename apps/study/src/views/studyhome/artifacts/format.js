// An artifact's items ↔ the Markdown body of its file in Artifacts/.
//
//   flashcards            slides                 quiz
//   ### Front             # Title                ### Question
//   Back text             Body text              - [ ] Wrong choice
//                         ---                    - [x] Right choice
//                         # Next title           > Why it is right
//
// Files can be edited by hand, so reading never drops text: anything before the first
// "###" of flashcards or a quiz becomes a leading item with an empty front or question
// (unusable, but kept on save). Slides are Marp-style: split by "---" lines, and the first
// "# " line of a slide is its title (none: an empty title).

import { turnText } from "../chats/format";

export const ARTIFACT_TYPES = ["flashcards", "slides", "quiz"];
export const TYPE_LABELS = { flashcards: "Flashcards", slides: "Slides", quiz: "Quiz" };

const HEADING = /^###[ \t]+(.*)$/;
const TITLE = /^#[ \t]+(.*)$/;
const BREAK = /^---$/;
const CHOICE = /^[-*][ \t]+\[([ xX])\][ \t]+(.*)$/;
const WHY = /^>[ \t]?(.*)$/;

const NOUNS = {
  flashcards: ["card", "cards"],
  slides: ["slide", "slides"],
  quiz: ["question", "questions"],
};

const lf = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
// Headings and choices are one line each, so a stray newline in one becomes a space.
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();

export const itemCount = (type, n) => `${n} ${NOUNS[type][n === 1 ? 0 : 1]}`;

// A line that would reload as a heading or a slide break gets one space in front, like
// escapeHeadings in the chats format.
const escapeLines = (text, pattern) =>
  lf(text).split("\n").map((line) => (pattern.test(line) ? ` ${line}` : line)).join("\n");

// Cuts the body at each heading; text before the first one is a section with a null heading.
function sections(body) {
  const out = [];
  let head = null;
  let lines = [];
  const finish = () => {
    if (head !== null || turnText(lines.join("\n"))) out.push({ head, lines });
  };
  for (const line of lf(body).split("\n")) {
    const m = HEADING.exec(line);
    if (!m) {
      lines.push(line);
      continue;
    }
    finish();
    head = m[1].trim();
    lines = [];
  }
  finish();
  return out;
}

function parseQuiz(body) {
  return sections(body).map(({ head, lines }) => {
    const choices = [];
    const why = [];
    const rest = [];
    for (const line of lines) {
      const choice = CHOICE.exec(line);
      const note = WHY.exec(line);
      if (choice) choices.push({ text: choice[2].trim(), right: choice[1] !== " " });
      else if (note) why.push(note[1]);
      else rest.push(line);
    }
    return { question: head ?? "", choices, why: turnText(why.join("\n")), rest: turnText(rest.join("\n")) };
  });
}

function parseSlides(body) {
  const chunks = [[]];
  for (const line of lf(body).split("\n")) {
    if (BREAK.test(line)) chunks.push([]);
    else chunks[chunks.length - 1].push(line);
  }
  if (chunks.length === 1 && !turnText(chunks[0].join("\n"))) return [];
  return chunks.map((lines) => {
    const at = lines.findIndex((line) => TITLE.test(line));
    if (at < 0) return { title: "", body: turnText(lines.join("\n")) };
    const rest = lines.filter((_, i) => i !== at);
    return { title: TITLE.exec(lines[at])[1].trim(), body: turnText(rest.join("\n")) };
  });
}

export function parseArtifact(type, body) {
  if (type === "quiz") return parseQuiz(body);
  if (type === "slides") return parseSlides(body);
  return sections(body).map(({ head, lines }) => ({ front: head ?? "", back: turnText(lines.join("\n")) }));
}

function formatCard(card, i) {
  const back = escapeLines(turnText(card.back), HEADING);
  if (i === 0 && !card.front && back) return `${back}\n`;
  return `### ${oneLine(card.front)}\n${back}\n`;
}

function formatSlide(slide) {
  const title = oneLine(slide.title);
  // With no title, a line that reads as one would become the title on reload.
  const body = escapeLines(turnText(slide.body), title ? BREAK : /^(?:---|#[ \t]+.*)$/);
  return `${title ? `# ${title}\n` : ""}${body}\n`;
}

function formatQuestion(q, i) {
  const rest = escapeLines(turnText(q.rest), HEADING);
  const why = turnText(q.why);
  const choices = q.choices ?? [];
  const lines = [];
  // A leading item has no heading, only the text that came before the first one.
  if (!(i === 0 && !q.question && (choices.length || why || rest))) lines.push(`### ${oneLine(q.question)}`);
  for (const c of choices) lines.push(`- [${c.right ? "x" : " "}] ${oneLine(c.text)}`);
  if (why) lines.push(...why.split("\n").map((line) => `> ${line}`));
  if (rest) lines.push(rest);
  return `${lines.join("\n")}\n`;
}

export function formatArtifact(type, items) {
  if (type === "slides") return items.map(formatSlide).join("\n---\n\n");
  return items.map(type === "quiz" ? formatQuestion : formatCard).join("\n");
}

// What stops an item from being used, in a sentence for the person; null when it is fine.
export function itemProblem(type, item, index) {
  const n = index + 1;
  if (type === "flashcards") {
    if (!item.front?.trim()) return `Card ${n} has an empty front.`;
    if (!item.back?.trim()) return `Card ${n} has an empty back.`;
    return null;
  }
  if (type === "slides") {
    return !item.title?.trim() && !item.body?.trim() ? `Slide ${n} is empty.` : null;
  }
  const choices = item.choices ?? [];
  if (!item.question?.trim()) return `Question ${n} has an empty question.`;
  if (choices.length < 2) return `Question ${n} needs at least two choices.`;
  const right = choices.filter((c) => c.right).length;
  if (right === 0) return `Question ${n} has no correct answer.`;
  if (right > 1) return `Question ${n} has more than one correct answer.`;
  return null;
}

export function problemsIn(type, items) {
  if (!items.length) return [`Kratt made no ${NOUNS[type][1]}.`];
  return items.map((item, i) => itemProblem(type, item, i)).filter(Boolean);
}

export const usableItems = (type, items) => items.filter((item, i) => !itemProblem(type, item, i));
