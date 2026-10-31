// How well a topic is known: 0..1, or null for not learned yet. The one
// place that turns that number into a level, a word and a brightness.

const KNOWN_FROM = 0.66;
const SHAKY_FROM = 0.33;

export function masteryLevel(mastery) {
  if (mastery === null) return "none";
  if (mastery >= KNOWN_FROM) return "known";
  if (mastery >= SHAKY_FROM) return "shaky";
  return "weak";
}

const WORDS = { none: "Not learned yet", known: "Known well", shaky: "Shaky", weak: "Weak" };

export function masteryWord(mastery) {
  return WORDS[masteryLevel(mastery)];
}

// Brightness of a topic's dot. Even a barely-known topic stays visible.
export function masteryOpacity(mastery) {
  return mastery === null ? 0 : 0.16 + 0.84 * mastery;
}

// Counts for summaries: weak topics count as shaky, since both need work.
export function countMastery(topics) {
  const counts = { known: 0, shaky: 0, none: 0 };
  topics.forEach(({ mastery }) => {
    const level = masteryLevel(mastery);
    counts[level === "weak" ? "shaky" : level] += 1;
  });
  return counts;
}

// Sample values the legend draws, so it always matches the dots.
export const LEGEND_SAMPLES = { known: 1, shaky: 0.35, weak: 0.1 };

// Pages due for review. Review scheduling doesn't exist yet, so nothing is
// ever due; the sidebar hides its section while this is empty.
export function dueForReview(state) { // eslint-disable-line no-unused-vars
  return [];
}
