import { describe, it, expect, vi } from "vitest";
import { createIngest } from "./ingest";
import { mutations } from "../data/operations";
import { stateFromSnapshot } from "../data/vaultState";
import { fakeClient, SAMPLE_SNAPSHOT } from "../data/testing/fakeVault";
import { VaultOffline } from "../data/vaultClient";

// A store like StudyProvider's: each action runs its operation on the latest state.
function makeStore(state) {
  let current = state;
  const actions = Object.fromEntries(
    Object.entries(mutations).map(([name, op]) => [
      name,
      vi.fn((...args) => {
        const result = op(current, ...args);
        current = result.id !== undefined && result.state ? result.state : result;
      }),
    ])
  );
  return { actions, getState: () => current };
}

// A File whose size can be faked (a 300 MB PDF without 300 MB of memory).
const makeFile = (name, text = "x", { type = "", size } = {}) => {
  const file = new File([text], name, { type });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};

function setup({ readPdf } = {}) {
  const client = fakeClient(SAMPLE_SNAPSHOT);
  const store = makeStore(stateFromSnapshot(SAMPLE_SNAPSHOT).state);
  readPdf ??= vi.fn(async () => ({ text: "PDF text", pageCount: 2, readPages: 2, truncated: false }));
  const ingest = createIngest({ client, actions: store.actions, getState: store.getState, readPdf });
  return { client, store, ingest, readPdf };
}

const source = (store, id) => store.getState().sources.find((s) => s.id === id);

const twoFilesAndLink = () => ({
  files: [
    { file: makeFile("notes.txt", "Cells divide.", { type: "text/plain" }), relPath: "Bio/notes.txt" },
    { file: makeFile("Chapter 9.pdf", "%PDF-1.4", { type: "application/pdf" }), relPath: "Bio/Chapter 9.pdf" },
  ],
  links: ["https://www.khanacademy.org/biology/"],
  skipped: [],
});

describe("createIngest", () => {
  it("adds files and links to the subject at once, then saves the originals", async () => {
    const { client, store, ingest } = setup();
    const subjectsBefore = store.getState().subjects;
    const planned = ingest.plan(twoFilesAndLink(), "Biology");

    expect(planned.count).toBe(3);
    expect(store.actions.addSources).toHaveBeenCalledTimes(1);
    const added = planned.sources.map((s) => source(store, s.id));
    expect(added.map((s) => s.subjects)).toEqual([["Biology"], ["Biology"], ["Biology"]]);
    const link = added.find((s) => s.type === "link");
    expect(link).toMatchObject({ url: "https://www.khanacademy.org/biology/", title: "khanacademy.org/biology" });
    const files = added.filter((s) => s.type === "file");
    expect(files.map((s) => s.upload)).toEqual(["uploading", "uploading"]);
    expect(files.map((s) => s.title).sort()).toEqual(["Chapter 9", "notes"]);
    expect(files.find((s) => s.title === "notes")).toMatchObject({ fileName: "notes.txt", fileSize: 13 });

    const result = await ingest.run(planned);
    expect(result).toMatchObject({ added: 3, existing: 0, notSaved: 0, skipped: 0 });
    const notes = store.getState().sources.find((s) => s.fileName === "notes.txt");
    expect(notes.file).toBe("Sources/files/Bio/notes.txt");
    expect(notes.content).toBe("Cells divide.");
    expect("upload" in notes).toBe(true);
    expect(notes.upload).toBeUndefined();
    const pdf = store.getState().sources.find((s) => s.fileName === "Chapter 9.pdf");
    expect(pdf).toMatchObject({ file: "Sources/files/Bio/Chapter 9.pdf", content: "PDF text", pageCount: 2, upload: undefined });
    // Each upload was checked first, then sent.
    expect(client.calls.filter((c) => c.method.startsWith("upload")).map((c) => c.method)).toEqual([
      "uploadCheck",
      "upload",
      "uploadCheck",
      "upload",
    ]);
    // Never a new subject.
    expect(store.getState().subjects).toBe(subjectsBefore);
    expect(store.actions.addSubject).not.toHaveBeenCalled();
  });

  it("the same drop again adds nothing and puts the existing ones in the subject", async () => {
    const { store, ingest } = setup();
    const intake = twoFilesAndLink();
    const first = ingest.plan(intake, null);
    await ingest.run(first);
    expect(first.sources.every((s) => source(store, s.id).subjects.length === 0)).toBe(true);

    const again = ingest.plan(intake, "Biology");
    expect(again.count).toBe(0);
    expect(again.existing.sort()).toEqual(first.sources.map((s) => s.id).sort());
    expect(store.getState().sources).toHaveLength(SAMPLE_SNAPSHOT.files.filter((f) => f.path.startsWith("Sources/")).length + 3);
    expect(first.sources.every((s) => source(store, s.id).subjects.includes("Biology"))).toBe(true);
    const result = await ingest.run(again);
    expect(result).toMatchObject({ added: 0, existing: 3, notSaved: 0 });
  });

  it("without a subject, sources go to Unsorted", () => {
    const { store, ingest } = setup();
    const planned = ingest.plan(twoFilesAndLink(), null);
    expect(planned.sources.map((s) => source(store, s.id).subjects)).toEqual([[], [], []]);
  });

  it("keeps folders and cleans each part of the path", async () => {
    const { client, ingest } = setup();
    const planned = ingest.plan({ files: [{ file: makeFile("m:1.png"), relPath: "Napoleon/maps?/m:1.png" }], links: [], skipped: [] }, null);
    await ingest.run(planned);
    expect(client.calls.find((c) => c.method === "upload").path).toBe("Sources/files/Napoleon/maps-/m-1.png");
  });

  it("a failed upload marks only that source not saved", async () => {
    const { client, store, ingest } = setup();
    const upload = client.upload;
    client.upload = async (path, blob, options) => {
      if (path.endsWith("notes.txt")) throw new Error("Disk on fire");
      return upload(path, blob, options);
    };
    const planned = ingest.plan(twoFilesAndLink(), "Biology");
    const result = await ingest.run(planned);
    expect(result).toMatchObject({ added: 3, notSaved: 1 });
    expect(result.messages).toEqual([{ name: "notes.txt", message: "Disk on fire" }]);
    const notes = store.getState().sources.find((s) => s.fileName === "notes.txt");
    expect(notes.upload).toBe("not-saved");
    expect(notes.file).toBeUndefined();
    const pdf = store.getState().sources.find((s) => s.fileName === "Chapter 9.pdf");
    expect(pdf.upload).toBeUndefined();
    expect(pdf.file).toBe("Sources/files/Bio/Chapter 9.pdf");
  });

  it("a refused upload check marks the source not saved with the engine's message, and sends nothing", async () => {
    const { client, store, ingest } = setup();
    client.checkError = "Not enough space on disk (needs 12.4 GB, 3.1 GB free)";
    const planned = ingest.plan(twoFilesAndLink(), null);
    const result = await ingest.run(planned);
    expect(result.notSaved).toBe(2);
    expect(result.messages[0]).toEqual({ name: "notes.txt", message: "Not enough space on disk (needs 12.4 GB, 3.1 GB free)" });
    expect(client.calls.some((c) => c.method === "upload")).toBe(false);
    expect(store.getState().sources.filter((s) => s.type === "file").map((s) => s.upload)).toEqual(["not-saved", "not-saved"]);
  });

  it("cancelling after the first file keeps it and discards pending files", async () => {
    const { client, store, ingest } = setup();
    const controller = new AbortController();
    const upload = client.upload;
    client.upload = async (...args) => {
      const answer = await upload(...args);
      controller.abort();
      return answer;
    };
    const intake = {
      files: ["a.txt", "b.txt", "c.txt"].map((name) => ({ file: makeFile(name, name, { type: "text/plain" }), relPath: name })),
      links: [],
      skipped: [],
    };
    const planned = ingest.plan(intake, "Biology");
    const result = await ingest.run(planned, { signal: controller.signal });
    expect(result).toMatchObject({ added: 1, notSaved: 0, cancelled: 2 });
    const byName = (n) => store.getState().sources.find((s) => s.fileName === n);
    expect(byName("a.txt")).toMatchObject({ file: "Sources/files/a.txt", upload: undefined });
    expect(byName("b.txt")).toBeUndefined();
    expect(byName("c.txt")).toBeUndefined();
    expect(client.calls.filter((c) => c.method === "upload")).toHaveLength(1);
  });

  it("an upload aborted midway marks it not saved and discards the rest", async () => {
    const { client, store, ingest } = setup();
    const controller = new AbortController();
    client.upload = async () => {
      controller.abort();
      throw Object.assign(new Error("Upload cancelled"), { name: "AbortError" });
    };
    const planned = ingest.plan(twoFilesAndLink(), null);
    const result = await ingest.run(planned, { signal: controller.signal });
    expect(result.notSaved).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.messages).toEqual([]);
    expect(store.getState().sources.filter((s) => s.type === "file").map((s) => s.upload)).toEqual(["not-saved"]);
  });

  it("a PDF over 200 MB keeps only its original, without reading it", async () => {
    const { store, ingest, readPdf } = setup();
    const big = makeFile("Atlas.pdf", "%PDF", { type: "application/pdf", size: 300 * 1024 * 1024 });
    const planned = ingest.plan({ files: [{ file: big, relPath: "Atlas.pdf" }], links: [], skipped: [] }, null);
    await ingest.run(planned);
    expect(readPdf).not.toHaveBeenCalled();
    const atlas = store.getState().sources.find((s) => s.fileName === "Atlas.pdf");
    expect(atlas).toMatchObject({ file: "Sources/files/Atlas.pdf", content: "", upload: undefined });
  });

  it("a text file over 1 MB is not read", async () => {
    const { store, ingest } = setup();
    const big = makeFile("log.txt", "hello", { type: "text/plain", size: 2 * 1024 * 1024 });
    const planned = ingest.plan({ files: [{ file: big, relPath: "log.txt" }], links: [], skipped: [] }, null);
    await ingest.run(planned);
    expect(store.getState().sources.find((s) => s.fileName === "log.txt").content).toBe("");
  });

  it("a damaged PDF is still saved, marked as unread", async () => {
    const { store, ingest } = setup({ readPdf: vi.fn(async () => Promise.reject(new Error("bad pdf"))) });
    const planned = ingest.plan({ files: [{ file: makeFile("bad.pdf", "x", { type: "application/pdf" }), relPath: "bad.pdf" }], links: [], skipped: [] }, null);
    const result = await ingest.run(planned);
    expect(result.notSaved).toBe(0);
    expect(store.getState().sources.find((s) => s.fileName === "bad.pdf")).toMatchObject({ readFailed: true, file: "Sources/files/bad.pdf" });
  });

  it("with the engine offline, every original is marked not saved", async () => {
    const { client, store, ingest } = setup();
    const planned = ingest.plan(twoFilesAndLink(), "Biology");
    client.fail = true;
    const result = await ingest.run(planned);
    expect(result).toMatchObject({ added: 3, notSaved: 2 });
    expect(result.messages[0].message).toBe(new VaultOffline().message);
    expect(store.getState().sources.filter((s) => s.type === "file").map((s) => s.upload)).toEqual(["not-saved", "not-saved"]);
  });

  it("reports progress per file with running byte totals", async () => {
    const { ingest } = setup();
    const intake = {
      files: [
        { file: makeFile("a.bin", "aaaa"), relPath: "a.bin" },
        { file: makeFile("b.bin", "bbbbbb"), relPath: "b.bin" },
      ],
      links: [],
      skipped: [],
    };
    const events = [];
    await ingest.run(ingest.plan(intake, null), { onProgress: (e) => events.push(e) });
    expect(events).toContainEqual({ index: 1, total: 2, name: "a.bin", loaded: 4, size: 4, doneBytes: 4, totalBytes: 10 });
    expect(events).toContainEqual({ index: 2, total: 2, name: "b.bin", loaded: 6, size: 6, doneBytes: 10, totalBytes: 10 });
    expect(events[0]).toMatchObject({ index: 1, loaded: 0, doneBytes: 0 });
  });

  it("counts too-large and unreadable skips, but not hidden ones", async () => {
    const { ingest } = setup();
    const planned = ingest.plan(
      {
        files: [],
        links: [],
        skipped: [
          { name: ".DS_Store", reason: "hidden" },
          { name: "huge.iso", reason: "too large" },
          { name: "locked", reason: "unreadable" },
        ],
      },
      null
    );
    expect(planned.skipped).toBe(2);
    expect(await ingest.run(planned)).toMatchObject({ added: 0, skipped: 2 });
  });

  it("asks before adding more than 50, and adds nothing when declined", () => {
    const { store, ingest } = setup();
    const many = Array.from({ length: 51 }, (_, i) => ({ file: makeFile(`f${i}.bin`), relPath: `f${i}.bin` }));
    const before = store.getState();
    const confirm = vi.fn(() => false);
    const planned = ingest.plan({ files: many, links: [], skipped: [] }, "Biology", { confirm });
    expect(confirm).toHaveBeenCalledWith(51);
    expect(planned).toMatchObject({ count: 51, cancelled: true, sources: [], uploads: [] });
    expect(store.getState()).toBe(before);

    const few = ingest.plan({ files: many.slice(0, 50), links: [], skipped: [] }, "Biology", { confirm });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(few.count).toBe(50);
  });
});

it("does not resurrect a source deleted during upload and trashes its completed original", async () => {
  const { client, store, ingest } = setup();
  const planned = ingest.plan({ files: [{ file: makeFile("deleted.bin"), relPath: "deleted.bin" }], links: [] }, null);
  client.upload = async (path) => { store.actions.deleteSource(planned.sources[0].id); return { path }; };
  await ingest.run(planned);
  expect(store.getState().sources.find((s) => s.id === planned.sources[0].id)).toBeUndefined();
  expect(client.calls).toContainEqual({ method: "trash", path: "Sources/files/deleted.bin" });
});
