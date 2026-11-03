import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { StudyProvider, useStudy } from "../data/StudyProvider";
import { fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";
import { UploadsProvider, useUploads } from "./UploadsProvider";
import UploadPanel from "./UploadPanel";

const MB = 1000 * 1000;
const makeFile = (name, size) => {
  const file = new File(["x"], name, { type: "application/octet-stream" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};
const intakeOf = (...files) => ({ files: files.map((file) => ({ file, relPath: file.name })), links: [], skipped: [] });

const SNAP = { folders: ["Biology", "Sources"], files: [], layout: { subjects: ["Biology"] } };

let toast, api, study;
beforeEach(() => {
  installMemoryLocalStorage();
  toast = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe() {
  api = useUploads();
  study = useStudy();
  return null;
}
// The routed view stands in for a tab: switching it away must not touch the panel.
function App({ client }) {
  const [view, setView] = useState("sources");
  return (
    <StudyProvider client={client}>
      <ShellContext.Provider value={{ toast, open: vi.fn() }}>
        <UploadsProvider>
          <Probe />
          <main>{view === "sources" ? <p>Sources view</p> : <p>Home view</p>}</main>
          <button onClick={() => setView("home")}>go home</button>
          <UploadPanel />
        </UploadsProvider>
      </ShellContext.Provider>
    </StudyProvider>
  );
}

// A client whose uploads wait for the test: release(n) finishes the n-th, progress(n, loaded) reports bytes.
function gatedClient() {
  const client = fakeClient(SNAP);
  const pending = [];
  client.upload = (path, blob, { onProgress, signal } = {}) =>
    new Promise((resolve, reject) => {
      const entry = { resolve: () => resolve({ path }), progress: (loaded) => onProgress?.(loaded, blob.size) };
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("Upload cancelled"), { name: "AbortError" })));
      pending.push(entry);
    });
  return { client, pending };
}

const mount = async (client) => {
  render(<App client={client} />);
  await screen.findByText("Sources view");
  await waitFor(() => expect(api && study).toBeTruthy());
};

it("shows which file is uploading and the bytes so far", async () => {
  const { client, pending } = gatedClient();
  await mount(client);
  let done;
  act(() => {
    done = api.add(intakeOf(makeFile("a.pdf", MB / 2), makeFile("b.pdf", MB / 2)), "Biology");
  });
  expect(await screen.findByText("Uploading 1 of 2 · a.pdf")).toBeTruthy();
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0].progress(MB / 2));
  expect(screen.getByText("0.5 MB of 1.0 MB")).toBeTruthy();
  expect(document.querySelector("progress")).toBeTruthy();
  expect(document.querySelector(".st-uploads .st-kratt").dataset.mode).toBe("think");
  act(() => pending[0].resolve());
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(screen.getByText("Uploading 2 of 2 · b.pdf")).toBeTruthy();
  act(() => pending[1].resolve());
  await act(() => done);
});

it("sums up what was added, and what was already there", async () => {
  const { client, pending } = gatedClient();
  await mount(client);
  const first = makeFile("a.pdf", 10);
  act(() => {
    api.add(intakeOf(first), "Biology");
  });
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0].resolve());
  await screen.findByText("Added 1 to Biology");
  expect(document.querySelector(".st-uploads .st-kratt").dataset.mode).toBe("hop");
  // The same name and size again, and one new file.
  act(() => {
    api.add(intakeOf(makeFile("a.pdf", 10), makeFile("c.pdf", 10)), "Biology");
  });
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => pending[1].resolve());
  expect(await screen.findByText("Added 1 to Biology · 1 already there")).toBeTruthy();
});

it("Cancel keeps the failed current source and discards files not started", async () => {
  const { client, pending } = gatedClient();
  await mount(client);
  act(() => {
    api.add(intakeOf(makeFile("a.pdf", 10), makeFile("b.pdf", 10)), "Biology");
  });
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByText(/Added 1 to Biology · 1 not saved · 1 cancelled/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

it("names the subject Unsorted and counts skipped files", async () => {
  const { client, pending } = gatedClient();
  await mount(client);
  act(() => {
    api.add({ ...intakeOf(makeFile("a.pdf", 10)), skipped: [{ name: "big.iso", reason: "too large" }, { name: ".x", reason: "hidden" }] }, null);
  });
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0].resolve());
  expect(await screen.findByText("Added 1 to Unsorted · 1 skipped")).toBeTruthy();
});

it("keeps the panel and finishes when the view changes mid-upload", async () => {
  const { client, pending } = gatedClient();
  await mount(client);
  act(() => {
    api.add(intakeOf(makeFile("a.pdf", 10)), "Biology");
  });
  await screen.findByText("Uploading 1 of 1 · a.pdf");
  fireEvent.click(screen.getByText("go home"));
  expect(screen.getByText("Home view")).toBeTruthy();
  expect(screen.getByText("Uploading 1 of 1 · a.pdf")).toBeTruthy();
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0].resolve());
  expect(await screen.findByText("Added 1 to Biology")).toBeTruthy();
  const source = study.state.sources.find((s) => s.fileName === "a.pdf");
  expect(source.upload).toBeUndefined();
  expect(source.file).toBe("Sources/files/a.pdf");
});

it("refuses with the offline message and adds nothing when the service is down", async () => {
  const { client } = gatedClient();
  await mount(client);
  client.fail = true;
  await act(() => api.add(intakeOf(makeFile("a.pdf", 10)), "Biology"));
  expect(toast).toHaveBeenCalledWith("The Study folder service isn't running");
  expect(study.state.sources).toHaveLength(0);
  expect(screen.queryByText(/Uploading/)).toBeNull();
});

it("asks before adding more than 50 files, and adds nothing on no", async () => {
  const { client } = gatedClient();
  await mount(client);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const files = Array.from({ length: 51 }, (_, i) => makeFile(`f${i}.bin`, 1));
  await act(() => api.add(intakeOf(...files), "Biology"));
  expect(confirm).toHaveBeenCalledWith("Add 51 files to Biology?");
  expect(study.state.sources).toHaveLength(0);
});

it("hides the panel 6 seconds after the run ends", async () => {
  const { client, pending } = gatedClient();
  await mount(client);
  act(() => {
    api.add(intakeOf(makeFile("a.pdf", 10)), "Biology");
  });
  await waitFor(() => expect(pending).toHaveLength(1));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    act(() => pending[0].resolve());
    await screen.findByText("Added 1 to Biology");
    act(() => vi.advanceTimersByTime(6100));
    expect(screen.queryByText("Added 1 to Biology")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("serializes queued drops and cancellation discards the waiting batch", async () => {
  const { client, pending } = gatedClient(); await mount(client);
  let first, second;
  act(() => { first = api.add(intakeOf(makeFile("first.bin", 10)), "Biology"); });
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => { second = api.add(intakeOf(makeFile("second.bin", 10)), "Biology"); });
  await waitFor(() => expect(study.state.sources).toHaveLength(2));
  expect(pending).toHaveLength(1);
  act(() => api.cancel()); await act(() => Promise.all([first, second]));
  expect(pending).toHaveLength(1);
  expect(study.state.sources).toHaveLength(1);
  expect(study.state.sources[0]).toMatchObject({ fileName: "first.bin", upload: "not-saved" });
  expect(api.status.running).toBe(false);
});
it("prevents switching Study folders while an upload is running", async () => {
  const { client, pending } = gatedClient(); await mount(client);
  let done; act(() => { done = api.add(intakeOf(makeFile("active.bin", 10)), "Biology"); });
  await waitFor(() => expect(pending).toHaveLength(1));
  await expect(study.vault.switchFolder("/different")).rejects.toThrow("Wait for uploads");
  expect(client.calls.some((c) => c.method === "setFolder")).toBe(false);
  act(() => pending[0].resolve()); await act(() => done);
});
it("names failed and skipped files in a dismissible summary", async () => {
  const client = fakeClient(SNAP); client.checkError = "Not enough space on disk"; await mount(client);
  await act(() => api.add({ ...intakeOf(makeFile("failed.bin", 10)), skipped: [{ name: "oversize.bin", reason: "too large" }] }, null));
  fireEvent.click(screen.getByText("Files needing attention"));
  expect(screen.getByText("failed.bin: Not enough space on disk")).toBeTruthy();
  expect(screen.getByText("oversize.bin: Over the 50 GB limit")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
});
