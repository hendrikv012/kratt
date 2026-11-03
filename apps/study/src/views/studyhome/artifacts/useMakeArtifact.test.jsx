import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { StudyProvider, useStudy } from "../data/StudyProvider";
import { SAMPLE_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";
import { CHAT_MESSAGES } from "../chats/chatService";
import { useMakeArtifact } from "./useMakeArtifact";

const BODY = "# Krebs\n\n### A?\nOne\n\n### B?\nTwo\n";
let hook;
let study;

function setup(notebookAsk) {
  hook = null;
  study = null;
  const client = fakeClient(SAMPLE_SNAPSHOT);
  client.notebookAsk = vi.fn(notebookAsk ?? (async () => ({ output: BODY })));
  function Probe() {
    hook = useMakeArtifact();
    study = useStudy();
    return null;
  }
  const shell = { chat: { address: "http://localhost:5055", local: false, memory: "normal" } };
  const view = render(
    <StudyProvider client={client}>
      <ShellContext.Provider value={shell}>
        <Probe />
      </ShellContext.Provider>
    </StudyProvider>
  );
  return { client, ...view };
}

const ready = () => waitFor(() => expect(study?.state.nodes.p1).toBeTruthy());
afterEach(() => vi.restoreAllMocks());

describe("useMakeArtifact", () => {
  it("make saves an artifact and returns its id", async () => {
    setup();
    await ready();
    let id;
    await act(async () => {
      id = await hook.make({ type: "flashcards", ids: ["p1"], topic: "", madeIn: { kind: "page", id: "p1" } });
    });
    const saved = study.state.artifacts.find((a) => a.id === id);
    expect(saved).toMatchObject({ title: "Krebs", type: "flashcards", madeFrom: ["p1"], madeIn: { kind: "page", id: "p1" }, parts: 1 });
    expect(saved.items).toHaveLength(2);
    expect(hook.busy).toBe(false);
    expect(hook.error).toBe(null);
  });

  it("error is set and nothing saved on failure", async () => {
    setup(async () => {
      throw new Error("ai-auth");
    });
    await ready();
    let id;
    await act(async () => {
      id = await hook.make({ type: "quiz", ids: ["p1"], topic: "", madeIn: null });
    });
    expect(id).toBe(null);
    expect(hook.error).toBe(CHAT_MESSAGES["ai-auth"]);
    expect(study.state.artifacts).toHaveLength(0);
    act(() => hook.clearError());
    expect(hook.error).toBe(null);
  });

  it("an unexpected error is logged and shows the generic message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // An answer that can't be read as text breaks inside the app, not in Kratt's engine.
    setup(async () => ({ output: { toString: () => { throw new Error("broken"); } } }));
    await ready();
    let id;
    await act(async () => {
      id = await hook.make({ type: "flashcards", ids: ["p1"], topic: "", madeIn: null });
    });
    expect(id).toBe(null);
    expect(hook.error).toBe(CHAT_MESSAGES["app-error"]);
    expect(log).toHaveBeenCalled();
  });

  it("cancel returns null without an error and saves nothing", async () => {
    let release;
    setup(() => new Promise((resolve) => (release = resolve)));
    await ready();
    let pending;
    act(() => {
      pending = hook.make({ type: "flashcards", ids: ["p1"], topic: "", madeIn: null });
    });
    await waitFor(() => expect(hook.busy).toBe(true));
    act(() => hook.cancel());
    expect(hook.busy).toBe(false); // before the send settles
    expect(hook.progress).toBe(null);
    release({ output: BODY });
    let id;
    await act(async () => {
      id = await pending;
    });
    expect(id).toBe(null);
    expect(hook.error).toBe(null);
    expect(hook.busy).toBe(false);
    expect(study.state.artifacts).toHaveLength(0);
  });

  it("unmount mid-make saves nothing and warns nothing", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    let release;
    const { unmount } = setup(() => new Promise((resolve) => (release = resolve)));
    await ready();
    const store = study;
    let pending;
    act(() => {
      pending = hook.make({ type: "flashcards", ids: ["p1"], topic: "", madeIn: null });
    });
    await waitFor(() => expect([hook.busy, hook.error]).toEqual([true, null]));
    unmount();
    const before = hook; // the last values the hook gave before unmount
    release({ output: BODY });
    expect(await pending).toBe(null);
    expect(store.state.artifacts).toHaveLength(0);
    expect(hook).toBe(before); // nothing re-rendered it: no state set after unmount
    expect(warn).not.toHaveBeenCalled();
  });
});
