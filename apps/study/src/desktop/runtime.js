import { invoke, isTauri } from "@tauri-apps/api/core";

export const isDesktop = () => isTauri();
export const connection = () => globalThis.__KRATT_DESKTOP__;
let starting;
export function startDesktop() {
  if (!starting) {
    starting = invoke("desktop_start").then((value) => {
      globalThis.__KRATT_DESKTOP__ = { ...connection(), ...value };
      window.dispatchEvent(new Event("kratt-engine-ready"));
      return value;
    }).finally(() => { starting = null; });
  }
  return starting;
}
export const openDesktop = (target) => invoke("desktop_open", { target });
