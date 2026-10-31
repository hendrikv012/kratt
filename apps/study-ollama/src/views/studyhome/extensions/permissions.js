export const PERMISSIONS = {
  "pages.read": "Read your pages and subjects",
  "pages.write": "Change your pages",
  "mastery.read": "See how well you know topics",
  "mastery.write": "Update how well you know topics",
  ai: "Ask the AI (uses your AI settings)",
  notifications: "Show reminders",
};

const NETWORK = "network:";

export function permissionLabel(perm) {
  if (typeof perm === "string" && perm.startsWith(NETWORK)) return `Connect to ${perm.slice(NETWORK.length)}`;
  return PERMISSIONS[perm] ?? String(perm);
}

export function isKnownPermission(perm) {
  if (typeof perm !== "string") return false;
  if (perm.startsWith(NETWORK)) return perm.length > NETWORK.length;
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, perm);
}

// null means always allowed.
export const METHOD_PERMISSIONS = {
  "pages.list": "pages.read",
  "pages.read": "pages.read",
  "subjects.list": "pages.read",
  "pages.write": "pages.write",
  "mastery.get": "mastery.read",
  "mastery.set": "mastery.write",
  "ai.ask": "ai",
  notify: "notifications",
  fetch: "network",
  "storage.get": null,
  "storage.set": null,
  "storage.remove": null,
  "ui.open": null,
  "ui.toast": null,
  "ui.resize": null,
  "block.save": null,
};

// string = needed permission, null = always allowed, undefined = unknown method.
export function requiredPermission(method, params) {
  if (!Object.prototype.hasOwnProperty.call(METHOD_PERMISSIONS, method)) return undefined;
  const need = METHOD_PERMISSIONS[method];
  if (need !== "network") return need;
  try {
    return `${NETWORK}${new URL(params?.url).hostname}`;
  } catch {
    return `${NETWORK}`;
  }
}

export function addedPermissions(oldList = [], newList = []) {
  const had = new Set(oldList);
  return newList.filter((p) => !had.has(p));
}
