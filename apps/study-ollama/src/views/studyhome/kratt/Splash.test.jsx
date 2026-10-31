import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { OFFLINE_MESSAGE } from "../data/StudyProvider";
import { VaultOffline } from "../data/vaultClient";
import { SAMPLE_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";
import { SPLASH_FADE_MS, SPLASH_SEQUENCE_MS } from "./Splash";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const saveSettings = (appearance) =>
  window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, ...appearance } }));

// Runs timers and the promises they settle (the fake service answers in a microtask).
const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  const store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
  window.history.replaceState(null, "", "/?view=study-preview");
  saveSettings({ openingAnimation: true });
});

afterEach(() => {
  vi.useRealTimers();
});

const homeTab = () => screen.queryByRole("tab", { name: "Home" });
const splash = () => document.querySelector(".st-splash");

describe("Splash", () => {
  it("plays then opens Home", async () => {
    render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
    expect(screen.getByRole("status", { name: "Opening KRATT" })).toBeTruthy();
    await advance(SPLASH_SEQUENCE_MS);
    expect(splash()).toBeTruthy();
    await advance(SPLASH_FADE_MS);
    expect(screen.queryByRole("status", { name: "Opening KRATT" })).toBeNull();
    expect(splash()).toBeNull();
    expect(homeTab()).toBeTruthy();
  });

  it("waits thinking while loading", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    client.snapshot = () => new Promise(() => {});
    render(<StudyPreview client={client} />);
    await advance(SPLASH_SEQUENCE_MS);
    const status = screen.getByRole("status", { name: "Opening your Study folder…" });
    expect(status.textContent).toContain("Opening your Study folder…");
    expect(status.querySelector(".st-kratt").getAttribute("data-mode")).toBe("think");
  });

  it("sleeps when offline", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    client.snapshot = () => Promise.reject(new VaultOffline());
    render(<StudyPreview client={client} />);
    await advance(SPLASH_SEQUENCE_MS);
    const status = screen.getByRole("status", { name: OFFLINE_MESSAGE });
    expect(status.textContent).toContain(OFFLINE_MESSAGE);
    expect(status.querySelector(".st-kratt").getAttribute("data-mode")).toBe("sleep");
    expect(homeTab()).toBeNull();
  });

  it("a key skips it", async () => {
    render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
    await advance(200);
    fireEvent.keyDown(window, { key: "a" });
    expect(homeTab()).toBeTruthy(); // the folder is open under the splash
    expect(splash()).toBeTruthy();
    await advance(SPLASH_FADE_MS);
    expect(splash()).toBeNull();
    expect(homeTab()).toBeTruthy();
  });

  it("no sequence when the opening animation is off", async () => {
    saveSettings({ openingAnimation: false });
    render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
    expect(screen.queryByRole("status", { name: "Opening KRATT" })).toBeNull();
    expect(splash()).toBeTruthy();
    await advance(0);
    expect(splash()).toBeNull();
    expect(homeTab()).toBeTruthy();
  });
});
