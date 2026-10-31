// Which dev-only page this window should show, from ?view=…, or null.
// Read once, before the first render, so the Launcher never flashes first.
// Only active in development builds.
const DEV_VIEWS = ["design-preview"];

export function readDevView() {
  if (!import.meta.env.DEV) return null;
  try {
    const view = new URLSearchParams(window.location.search).get("view");
    return DEV_VIEWS.includes(view) ? view : null;
  } catch {
    return null;
  }
}
