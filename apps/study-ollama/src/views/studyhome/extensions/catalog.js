import { invoke, isTauri } from "@tauri-apps/api/core";
import { isValidId } from "./manifest.js";
import { addedPermissions } from "./permissions.js";
import { compareVersions, isSemver } from "./semver.js";

const CACHE_KEY = "study-extensions-catalog-cache-v1";
const SHA_RE = /^[0-9a-fA-F]{64}$/;

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const downloadOk = (u) => typeof u === "string" && /^(https:\/\/|file:\/\/)/i.test(u);

const optStr = (v) => v === undefined || typeof v === "string";
const optStrList = (v) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string"));

function entryOk(e) {
  return (
    e &&
    typeof e === "object" &&
    isValidId(e.id) &&
    nonEmpty(e.name) &&
    typeof e.version === "string" &&
    isSemver(e.version) &&
    downloadOk(e.download) &&
    typeof e.sha256 === "string" &&
    SHA_RE.test(e.sha256) &&
    optStr(e.description) &&
    optStr(e.author) &&
    optStr(e.icon) &&
    optStrList(e.permissions) &&
    optStrList(e.kinds)
  );
}

export function parseCatalog(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { entries: [], skipped: 0, error: "bad-json" };
  }
  if (!json || typeof json !== "object" || !Array.isArray(json.extensions)) {
    return { entries: [], skipped: 0, error: "bad-json" };
  }
  const entries = [];
  let skipped = 0;
  for (const e of json.extensions) {
    if (entryOk(e)) entries.push({ ...e, permissions: e.permissions ?? [] });
    else skipped += 1;
  }
  return { entries, skipped };
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && Array.isArray(c.entries)) return c;
  } catch {
    /* no usable cache */
  }
  return null;
}

function writeCache(entries, fetchedAt) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ entries, fetchedAt }));
  } catch {
    /* storage unavailable */
  }
}

function fromCache() {
  const c = readCache();
  return c ? { entries: c.entries, offline: true, fetchedAt: c.fetchedAt } : { entries: [], offline: true };
}

export async function loadCatalog(url) {
  if (!url) return { entries: [], offline: false };
  let text;
  try {
    if (isTauri()) {
      text = await invoke("ext_fetch_text", { url });
    } else {
      // Browser mode: https only; anything else is treated as offline.
      if (!/^https:\/\//i.test(url)) return fromCache();
      const resp = await fetch(url);
      if (!resp.ok) return fromCache();
      text = await resp.text();
    }
  } catch {
    return fromCache();
  }
  const parsed = parseCatalog(text);
  if (parsed.error) return fromCache();
  const fetchedAt = Date.now();
  writeCache(parsed.entries, fetchedAt);
  return { entries: parsed.entries, skipped: parsed.skipped, offline: false, fetchedAt };
}

export function updateFor(record, entry) {
  if (!record || !entry || record.source !== "catalog") return null;
  if (compareVersions(entry.version, record.version) <= 0) return null;
  return { version: entry.version, needs: addedPermissions(record.granted, entry.permissions) };
}
