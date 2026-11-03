// Does a question ask Kratt to make study material? Returns the artifact type, or null.

const VERB = /\b(make|create|generate|give me|turn\b.*\binto)\b/i;
const NOUNS = [
  ["flashcards", /\b(flash\s?cards?|cards)\b/i],
  ["slides", /\b(slides?|deck|presentation)\b/i],
  ["quiz", /\b(quiz|quizzes)\b/i],
];

export function wantsArtifact(question) {
  const text = String(question ?? "");
  if (!VERB.test(text)) return null;
  return NOUNS.find(([, noun]) => noun.test(text))?.[0] ?? null;
}
