import { useEffect, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { Group, Row, Section, Segmented, Select, Toggle } from "./controls";

export function StudyingSection({ value, set }) {
  return (
    <Section title="Studying" description="How study sessions and reviews work.">
      <Group>
        <Row label="Session length" description="Sessions stop at a natural break around this time.">
          <Segmented
            label="Session length"
            value={value.session}
            onChange={(v) => set({ session: v })}
            options={[
              { value: "5", label: "5 min" },
              { value: "10", label: "10 min" },
              { value: "15", label: "15 min" },
            ]}
          />
        </Row>
        <Row label="How fast topics fade" description="Strict asks you to review sooner. Gentle waits longer.">
          <Segmented
            label="How fast topics fade"
            value={value.fade}
            onChange={(v) => set({ fade: v })}
            options={[
              { value: "gentle", label: "Gentle" },
              { value: "normal", label: "Normal" },
              { value: "strict", label: "Strict" },
            ]}
          />
        </Row>
        <Row label="Quick check style" htmlFor="st-quiz">
          <Select
            id="st-quiz"
            value={value.quiz}
            onChange={(v) => set({ quiz: v })}
            options={[
              { value: "choice", label: "Multiple choice" },
              { value: "typing", label: "Type the answer" },
              { value: "mixed", label: "Mixed" },
            ]}
          />
        </Row>
        <Row label="Warm-up reviews" description="Start each session with one or two fading topics.">
          <Toggle label="Warm-up reviews" checked={value.warmup} onChange={(v) => set({ warmup: v })} />
        </Row>
      </Group>
      <p className="st-set-note">
        Surveys only start when you ask for one, from a subject's page. If you skip it, the app assumes you're
        starting from scratch and begins with the first topic.
      </p>
    </Section>
  );
}

const CORRECTIONS = [
  { what: "Krebs cycle, step 2", fix: "Citrate has six carbons, not five", when: "2 Oct" },
  { what: "Nucleus", fix: "Moved from Cell division to Cell structure", when: "29 Sep" },
  { what: "Link: Napoleon to Industrial Revolution", fix: "Removed", when: "26 Sep" },
];

const STATUS_TEXT = { checking: "Checking…", on: "Connected to Open Notebook", off: "Open Notebook isn't answering" };
const STATUS_EVERY = 10_000;
const ROW_CONTROLS = { display: "flex", alignItems: "center", gap: 8 };

// Open Notebook runs the AI that extensions ask. The app reaches it through the Study folder
// service, which also keeps its password, so the password is never stored in settings.
function OpenNotebookRows({ value, set }) {
  const client = useStudy()?.client;
  const [status, setStatus] = useState("checking");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!client) return undefined;
    let stopped = false;
    const check = () =>
      client.notebookStatus(value.onUrl).then(
        (answer) => !stopped && setStatus(answer.ok ? "on" : "off"),
        () => !stopped && setStatus("off")
      );
    setStatus("checking");
    const first = setTimeout(check, 400); // once typing in the address settles
    const again = setInterval(check, STATUS_EVERY);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(again);
    };
  }, [client, value.onUrl]);

  useEffect(() => {
    client?.hasNotebookPassword().then((answer) => setHasPassword(Boolean(answer.set)), () => {});
  }, [client]);

  const savePassword = async (next) => {
    setSaveError("");
    try {
      await client.setNotebookPassword(next);
      setHasPassword(Boolean(next));
      setPassword("");
    } catch (error) {
      setSaveError(error.message);
    }
  };

  return (
    <>
      <Row label="Open Notebook address" description="Where Open Notebook runs. Extensions that use AI send their prompts there." htmlFor="st-on-url">
        <input
          id="st-on-url"
          className="st-input"
          type="url"
          spellCheck={false}
          value={value.onUrl}
          onChange={(e) => set({ onUrl: e.target.value })}
        />
      </Row>
      <Row
        label="Open Notebook password"
        description={
          <>
            Only needed if you set <span style={{ overflowWrap: "anywhere" }}>OPEN_NOTEBOOK_PASSWORD</span>. Kept by the Study
            folder service, not in settings.
          </>
        }
        htmlFor={hasPassword ? undefined : "st-on-password"}
      >
        {hasPassword ? (
          <span style={ROW_CONTROLS}>
            <span className="st-faint">A password is set</span>
            <button className="st-ghost-button" onClick={() => savePassword(null)}>
              Remove password
            </button>
          </span>
        ) : (
          <span style={ROW_CONTROLS}>
            <input
              id="st-on-password"
              className="st-input"
              style={{ width: "10rem" }}
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="st-ghost-button" disabled={!password || !client} onClick={() => savePassword(password)}>
              Save password
            </button>
          </span>
        )}
        {saveError && <p className="st-faint st-small">{saveError}</p>}
      </Row>
      <Row label="AI engine" description="Open Notebook, checked every few seconds while this is open.">
        <span className="st-status" role="status">
          <i data-state={status === "on" ? "on" : "off"} /> {STATUS_TEXT[status]}
        </span>
      </Row>
    </>
  );
}

const LOCAL_STATE_TEXT = {
  checking: "Checking…",
  running: "Ollama is running",
  started: "Kratt started Ollama",
  "not-installed": "Ollama isn't installed",
  failed: "Ollama didn't start",
  offline: "The Study folder service isn't running",
};

// Ollama runs the AI on this computer. The Study folder service starts it when it isn't running
// (asking for its state is enough) and lists only the models already installed; nothing is
// downloaded from here. The model picked is kept by the service, which uses it for every answer.
function LocalModelRows() {
  const client = useStudy()?.client;
  const [status, setStatus] = useState({ state: "checking", detail: "", models: [], model: null });
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!client) return undefined;
    let stopped = false;
    const check = () =>
      client.localStatus().then(
        (answer) => !stopped && setStatus(answer),
        () => !stopped && setStatus((s) => ({ ...s, state: "offline", models: [] }))
      );
    check();
    const again = setInterval(check, STATUS_EVERY);
    return () => {
      stopped = true;
      clearInterval(again);
    };
  }, [client]);

  const pick = async (model) => {
    setSaveError("");
    try {
      const saved = await client.setLocalAi({ model });
      setStatus((s) => ({ ...s, model: saved.model }));
    } catch (error) {
      setSaveError(error.message);
    }
  };

  const { state, detail, models, model } = status;
  const up = state === "running" || state === "started";
  const missing = up && model && !models.includes(model) && !models.includes(`${model}:latest`);
  let note = null;
  if (state === "not-installed") {
    note = (
      <>
        Kratt uses Ollama to run the AI on this computer. Install it from{" "}
        <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
          ollama.com
        </a>
        , then come back here.
      </>
    );
  } else if (state === "failed") {
    note = (
      <>
        Try opening the Ollama app yourself, then come back here.
        {detail && <span className="st-local-detail">{detail}</span>}
      </>
    );
  } else if (up && models.length === 0) {
    note = (
      <>
        No models are installed in Ollama yet. In a terminal, run <code>ollama pull llama3.2</code>, then come back here.
      </>
    );
  } else if (missing) {
    note = <>{model} isn't installed in Ollama any more. Pick another model.</>;
  }

  const options = [
    ...(model && !missing ? [] : [{ value: "", label: "Pick a model" }]),
    ...models.map((name) => ({ value: name, label: name })),
  ];
  const chosen = missing ? "" : (models.find((name) => name === model || name === `${model}:latest`) ?? "");

  return (
    <>
      <Row label="Ollama" description="Runs the AI on this computer. Kratt starts it when it isn't running.">
        <span className="st-status" role="status">
          <i data-state={up ? "on" : "off"} /> {LOCAL_STATE_TEXT[state] ?? state}
        </span>
      </Row>
      {up && models.length > 0 && (
        <Row label="Model" description="Only models already installed in Ollama are listed." htmlFor="st-local-model">
          <Select id="st-local-model" value={chosen} options={options} onChange={(v) => v && pick(v)} />
        </Row>
      )}
      {note && (
        <p className="st-set-note" role="note">
          {note}
        </p>
      )}
      {saveError && <p className="st-faint st-small">{saveError}</p>}
    </>
  );
}

export function AiSection({ value, set }) {
  const [undone, setUndone] = useState([]);
  return (
    <Section title="AI" description="What the AI can do and what it remembers.">
      <Group title="Model">
        <Row label="Where the AI runs" description="On this computer keeps everything private but needs a capable machine.">
          <Segmented
            label="Where the AI runs"
            value={value.model}
            onChange={(v) => set({ model: v })}
            options={[
              { value: "local", label: "On this computer" },
              { value: "cloud", label: "Online service" },
            ]}
          />
        </Row>
        {value.model === "local" && <LocalModelRows />}
        {value.model === "cloud" && (
          <Row label="API key" description="Stored only on this computer." htmlFor="st-api-key">
            <input
              id="st-api-key"
              className="st-input"
              type="password"
              placeholder="Paste your key"
              value={value.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </Row>
        )}
        {value.model === "cloud" && <OpenNotebookRows value={value} set={set} />}
        <Row
          label="Chat memory"
          description="How much of the page, your notes and this chat is sent with each question. Pick Short if answers ignore what you said earlier."
        >
          <Segmented
            label="Chat memory"
            value={value.chatMemory}
            onChange={(v) => set({ chatMemory: v })}
            options={[
              { value: "short", label: "Short" },
              { value: "normal", label: "Normal" },
              { value: "long", label: "Long" },
            ]}
          />
        </Row>
      </Group>

      <Group title="Behavior">
        <Row label="File and link topics automatically" description="The AI sorts new topics into subjects and connects related ones.">
          <Toggle label="File and link topics automatically" checked={value.autoFile} onChange={(v) => set({ autoFile: v })} />
        </Row>
        <Row label="Mark what the AI made" description="Shows a small mark on topics, links and notes the AI created.">
          <Toggle label="Mark what the AI made" checked={value.markAi} onChange={(v) => set({ markAi: v })} />
        </Row>
        <Row label="Keep Kratt Chat closed until I open it">
          <Toggle label="Keep Kratt Chat closed" checked={value.chatHidden} onChange={(v) => set({ chatHidden: v })} />
        </Row>
      </Group>

      <Group title="Your corrections">
        <p className="st-set-empty" style={{ marginTop: 0 }}>
          When you fix something the AI got wrong, it remembers. Undo a correction to let the AI decide again.
        </p>
        <ul className="st-corrections">
          {CORRECTIONS.map((c) => (
            <li key={c.what}>
              <div>
                <span>{c.what}</span>
                <p>{c.fix}</p>
              </div>
              <span className="st-faint st-small">{c.when}</span>
              {undone.includes(c.what) ? (
                <span className="st-faint st-small">Undone</span>
              ) : (
                <button className="st-ghost-button" onClick={() => setUndone((u) => [...u, c.what])}>
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      </Group>
    </Section>
  );
}
