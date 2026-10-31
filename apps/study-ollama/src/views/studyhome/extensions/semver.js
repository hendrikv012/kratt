// Plain MAJOR.MINOR.PATCH comparison; a prerelease sorts lower than its release.
const RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isSemver(v) {
  return typeof v === "string" && RE.test(v);
}

export function compareVersions(a, b) {
  const pa = RE.exec(a);
  const pb = RE.exec(b);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa[4] && !pb[4]) return -1;
  if (!pa[4] && pb[4]) return 1;
  if (pa[4] === pb[4]) return 0;
  return pa[4] < pb[4] ? -1 : 1;
}
