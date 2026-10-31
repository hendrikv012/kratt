import { invoke, isTauri } from "@tauri-apps/api/core";
import { version as appVersion } from "../../../../package.json";
import { validateManifest } from "./manifest.js";

// The one place the app version is read for minAppVersion checks.
export const APP_VERSION = appVersion;

// code: "invalid" (errors lists what is wrong), "source" (a download the app
// won't make) or "stage" (Rust refused the archive; message says why).
export class ExtensionError extends Error {
  constructor(code, detail) {
    const errors = Array.isArray(detail) ? detail : [];
    super(Array.isArray(detail) ? errors.join("; ") : String(detail ?? code));
    this.name = "ExtensionError";
    this.code = code;
    this.errors = errors;
  }
}

export const canInstall = () => isTauri();

async function stage(command, args) {
  let staged;
  try {
    staged = await invoke(command, args);
  } catch (e) {
    throw new ExtensionError("stage", typeof e === "string" ? e : e?.message ?? "Couldn't read the extension");
  }
  let json;
  let errors;
  try {
    json = JSON.parse(staged.manifestJson);
  } catch {
    errors = ["extension.json isn't valid JSON"];
  }
  if (!errors) {
    const result = validateManifest(json, { files: new Set(staged.files), appVersion: APP_VERSION });
    if (result.ok) return { ...staged, manifest: result.manifest };
    errors = result.errors;
  }
  await discardStaged(staged).catch(() => {});
  throw new ExtensionError("invalid", errors);
}

// A file:// download is only trusted when the catalog itself came from a
// file:// URL, so a remote catalog can't make the app read local files.
export function stageFromCatalog(entry, { catalogUrl } = {}) {
  const url = entry.download;
  const isFile = /^file:\/\//i.test(url);
  if (isFile ? !/^file:\/\//i.test(catalogUrl ?? "") : !/^https:\/\//i.test(url)) {
    return Promise.reject(new ExtensionError("source", "This download isn't allowed from this catalog"));
  }
  return stage("ext_stage_download", { url, sha256: entry.sha256 });
}

export const stageFromFile = (path) => stage("ext_stage_file", { path });

export const commitStaged = (staged) =>
  invoke("ext_commit", { stagingId: staged.stagingId, id: staged.manifest.id, version: staged.manifest.version });

export const discardStaged = (staged) => invoke("ext_discard", { stagingId: staged.stagingId });

export async function removeFiles(id, version = null) {
  if (!canInstall()) return;
  await invoke("ext_remove", { id, version });
}
