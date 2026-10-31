// Pure validation. No browser globals and no Tauri imports: the build script
// imports this under vite-node.
import { COLOR_ROLES, BASE_PALETTES } from "../theme/legacyPalettes.js";
import { isKnownPermission } from "./permissions.js";
import { compareVersions, isSemver } from "./semver.js";

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
export const isValidId = (id) => typeof id === "string" && ID_RE.test(id) && id.length <= 64;
const HEX = /^#[0-9a-fA-F]{6}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const hostOk = (h) => h.length <= 253 && HOST_RE.test(h) && h.split(".").every((l) => l.length <= 63);
const KINDS = [
  ["widgets", "widget"],
  ["blocks", "block"],
  ["tools", "tool"],
  ["themes", "theme"],
  ["commands", "command"],
];
const LIMITS = { name: 40, author: 60, description: 300 };
const LIMIT_LABEL = { name: "Name", author: "Author", description: "Description" };

const PATH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
function badPath(p) {
  return typeof p !== "string" || !PATH_RE.test(p) || p.split("/").some((s) => s === "." || s === "..");
}

export function validateTheme(theme) {
  const errors = [];
  const label = `Theme ${theme?.name || theme?.id || "(unnamed)"}`;
  if (!theme || typeof theme !== "object") return [`${label} is not valid`];
  if (!Object.prototype.hasOwnProperty.call(BASE_PALETTES, theme.base)) {
    errors.push(`${label}: base must be one of ${Object.keys(BASE_PALETTES).join(", ")}`);
  }
  for (const { key, label: roleLabel } of COLOR_ROLES) {
    const v = theme.colors?.[key];
    if (v === undefined || v === null || v === "") errors.push(`${label} is missing the ${roleLabel} color`);
    else if (typeof v !== "string" || !HEX.test(v)) errors.push(`${label}: ${key} must be a #rrggbb color`);
  }
  if (typeof theme.accent !== "string" || !HEX.test(theme.accent)) errors.push(`${label}: accent must be a #rrggbb color`);
  if (theme.glow != null && (typeof theme.glow !== "string" || !HEX.test(theme.glow))) {
    errors.push(`${label}: glow must be a #rrggbb color`);
  }
  if (!Array.isArray(theme.subjects) || theme.subjects.length !== 8) {
    errors.push(`${label} needs exactly 8 subject colors`);
  } else if (!theme.subjects.every((c) => typeof c === "string" && HEX.test(c))) {
    errors.push(`${label}: subject colors must be #rrggbb colors`);
  }
  return errors;
}

export function kindsOf(manifest) {
  const c = manifest?.contributes || {};
  return KINDS.filter(([plural]) => Array.isArray(c[plural]) && c[plural].length > 0).map(([, kind]) => kind);
}

export function validateManifest(json, { files, appVersion } = {}) {
  const errors = [];
  const add = (m) => {
    if (!errors.includes(m)) errors.push(m);
  };
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, errors: ["The extension file isn't valid"] };
  }

  if (typeof json.id !== "string" || json.id === "") add("Missing id");
  else if (!isValidId(json.id)) add("Id must look like author.name (lowercase)");

  if (json.version === undefined) add("Missing version");
  else if (!isSemver(json.version)) add("Version must look like 1.2.0");

  for (const key of ["name", "author", "description"]) {
    const v = json[key];
    if (typeof v !== "string" || v.trim() === "") add(`Missing ${key}`);
    else if (v.length > LIMITS[key]) add(`${LIMIT_LABEL[key]} is too long (${LIMITS[key]} characters max)`);
  }

  if (json.minAppVersion !== undefined) {
    if (!isSemver(json.minAppVersion)) add("Minimum app version must look like 1.0.0");
    else if (appVersion && compareVersions(json.minAppVersion, appVersion) > 0) add("Needs a newer version of the app");
  }

  const perms = json.permissions === undefined ? [] : json.permissions;
  if (!Array.isArray(perms)) add("Permissions must be a list");
  else {
    for (const p of perms) {
      if (typeof p === "string" && p.startsWith("network:")) {
        const host = p.slice("network:".length);
        if (!hostOk(host)) add(`Network permission needs a plain host name: ${host}`);
      } else if (!isKnownPermission(p)) add(`Unknown permission: ${p}`);
    }
  }

  const checkFile = (p) => {
    if (badPath(p)) add(`Bad path: ${p}`);
    else if (files && !files.has(p)) add(`File not found in the extension: ${p}`);
  };
  if (json.icon !== undefined) checkFile(json.icon);

  const contributes = json.contributes && typeof json.contributes === "object" ? json.contributes : {};
  const normal = {};
  const seen = new Set();
  for (const [plural, kind] of KINDS) {
    const list = contributes[plural];
    normal[plural] = Array.isArray(list) ? list : [];
    normal[plural].forEach((item, i) => {
      if (!item || typeof item !== "object") return add(`A ${kind} entry isn't valid`);
      if (typeof item.id !== "string" || item.id === "") add(`A ${kind} is missing its id`);
      else if (seen.has(item.id)) add(`Duplicate id: ${item.id}`);
      else seen.add(item.id);
      if (kind !== "theme") {
        if (typeof item.title !== "string" || item.title === "") add(`The ${kind} ${item.id ?? i + 1} is missing a title`);
        checkFile(item.entry);
        if (item.icon !== undefined) checkFile(item.icon);
      } else {
        validateTheme(item).forEach(add);
      }
    });
  }
  if (!KINDS.some(([plural]) => normal[plural].length > 0)) {
    add("Adds nothing: list at least one widget, block, tool, theme or command");
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: { ...json, permissions: perms, contributes: normal } };
}
