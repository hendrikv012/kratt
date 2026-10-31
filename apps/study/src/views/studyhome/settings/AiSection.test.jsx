import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";

let store;
beforeEach(() => {
  store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
  window.history.replaceState(null, "", "/?settings=ai");
});

afterEach(() => cleanup());

const openAi = async (client) => {
  render(<StudyPreview client={client} />);
  return screen.findByRole("dialog", { name: "Settings" });
};

// Open Notebook's rows show when the AI runs online.
const openOnline = async (client) => {
  const dialog = await openAi(client);
  const where = within(dialog).getByRole("radiogroup", { name: "Where the AI runs" });
  fireEvent.click(within(where).getByRole("radio", { name: "Online service" }));
  return dialog;
};

const ollama = (client, local) => Object.assign(client.local, local);

describe("Settings > AI, on this computer (Ollama)", () => {
  it("says how to install Ollama when it isn't there", async () => {
    const dialog = await openAi(fakeClient(EMPTY_SNAPSHOT));
    await within(dialog).findByText("Ollama isn't installed");
    expect(within(dialog).getByRole("link", { name: "ollama.com" }).getAttribute("href")).toBe("https://ollama.com/download");
    expect(within(dialog).queryByLabelText("Model")).toBeNull();
    expect(within(dialog).queryByLabelText("Kratt's engine address")).toBeNull();
  });

  it("shows why Ollama didn't start", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    ollama(client, { state: "failed", detail: "Error: listen tcp 127.0.0.1:11434: bind: address already in use" });
    const dialog = await openAi(client);
    await within(dialog).findByText("Ollama didn't start");
    expect(within(dialog).getByRole("note").textContent).toContain("address already in use");
  });

  it("says how to get a model when none is installed", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    ollama(client, { state: "running", models: [] });
    const dialog = await openAi(client);
    await within(dialog).findByText("Ollama is running");
    expect(within(dialog).getByRole("note").textContent).toContain("ollama pull llama3.2");
    expect(within(dialog).queryByLabelText("Model")).toBeNull();
  });

  it("lists only installed models and keeps the one picked in the service", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    ollama(client, { state: "started", models: ["llama3.2:1b", "qwen3:4b"] });
    const dialog = await openAi(client);
    await within(dialog).findByText("Kratt started Ollama");
    const select = within(dialog).getByLabelText("Model");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Pick a model", "llama3.2:1b", "qwen3:4b"]);
    fireEvent.change(select, { target: { value: "qwen3:4b" } });
    await waitFor(() => expect(client.local.model).toBe("qwen3:4b"));
    await waitFor(() => expect([...within(dialog).getByLabelText("Model").options].map((o) => o.value)).toEqual(["llama3.2:1b", "qwen3:4b"]));
    expect(within(dialog).getByLabelText("Model").value).toBe("qwen3:4b");
    expect(Object.values(store).join(" ")).not.toContain("qwen3:4b");
  });

  it("says when the picked model was removed from Ollama", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    ollama(client, { state: "running", model: "mistral:7b", models: ["llama3.2:1b"] });
    const dialog = await openAi(client);
    await within(dialog).findByText("mistral:7b isn't installed in Ollama any more. Pick another model.");
    expect(within(dialog).getByLabelText("Model").value).toBe("");
  });

  it("tells the service when the AI runs online instead", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    await openOnline(client);
    await waitFor(() => expect(client.local.local).toBe(false));
    expect(screen.queryByText("Ollama isn't installed")).toBeNull();
  });
});

describe("Settings > AI, Open Notebook", () => {
  it("shows the address and whether Open Notebook answers there", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    const dialog = await openOnline(client);
    expect(within(dialog).getByLabelText("Kratt's engine address").value).toBe("http://localhost:5055");
    await within(dialog).findByText("Kratt's engine isn't answering");
    expect(client.calls).toContainEqual({ method: "notebookStatus", address: "http://localhost:5055" });
  });

  it("checks a new address and keeps it in settings", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    client.notebookOk = true;
    const dialog = await openOnline(client);
    fireEvent.change(within(dialog).getByLabelText("Kratt's engine address"), { target: { value: "http://notes.local:5055" } });
    await within(dialog).findByText("Connected to Kratt's engine");
    await waitFor(() => expect(client.calls).toContainEqual({ method: "notebookStatus", address: "http://notes.local:5055" }));
    expect(Object.values(store).join(" ")).toContain("http://notes.local:5055");
  });

  it("saves the password through the service, never in settings", async () => {
    const client = fakeClient(EMPTY_SNAPSHOT);
    const dialog = await openOnline(client);
    fireEvent.change(within(dialog).getByLabelText("Kratt's engine password"), { target: { value: "s3cret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
    await within(dialog).findByText("A password is set");
    expect(client.notebookPassword).toBe("s3cret");
    expect(Object.values(store).join(" ")).not.toContain("s3cret");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove password" }));
    await waitFor(() => expect(client.notebookPassword).toBeNull());
  });

  it("chooses Chat memory", async () => {
    const dialog = await openAi(fakeClient(EMPTY_SNAPSHOT));
    const group = within(dialog).getByRole("radiogroup", { name: "Chat memory" });
    expect(within(group).getByRole("radio", { name: "Normal" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Short" }));
    await waitFor(() => expect(JSON.parse(store["study-preview-settings-v3"]).ai.chatMemory).toBe("short"));
  });
});
