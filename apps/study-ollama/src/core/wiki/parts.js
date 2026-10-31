// The parts of a wiki link's text, "path#hash|alt": what the WikiLink node and note
// files both read.
export function wikiLinkParts(raw) {
  const m = /^(?<path>[^#|]+)(?:#(?<hash>[^|]+))?(?:\|(?<alt>.*))?$/.exec(raw || '')
  const path = m?.groups?.path?.trim() || raw
  const hash = m?.groups?.hash?.trim() || ''
  return { path, hash, alt: (m?.groups?.alt ?? '').trim(), href: hash ? `${path}#${hash}` : path }
}
