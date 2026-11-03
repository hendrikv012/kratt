// Artifacts in chat answers: "[[artifact:<id>|Label · Title]]", told apart from [[Page]] links.

import { TYPE_LABELS } from "./format";

const LINK = /\[\[artifact:([^|\]]+)\|([^\]]*)\]\]/g;

// | [ and ] in a title would end the link early, so they become "-".
export const artifactLink = ({ id, type, title }) => `[[artifact:${id}|${TYPE_LABELS[type]} · ${String(title).replace(/[|[\]]/g, "-")}]]`;

// The text as plain strings and { id, label } for each artifact link, in order.
export function splitArtifactLinks(input) {
  const text = String(input ?? "");
  const out = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ id: m[1], label: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
