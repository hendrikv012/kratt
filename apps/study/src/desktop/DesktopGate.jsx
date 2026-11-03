import { useEffect, useMemo, useState } from "react";
import { createVaultClient } from "../views/studyhome/data/vaultClient";
import { connection, isDesktop, openDesktop, startDesktop } from "./runtime";
import ModelDownload from "./ModelDownload";
import "@fontsource/pixelify-sans/500.css";
import "@fontsource-variable/geist/wght.css";
import "./desktop.css";

export default function DesktopGate({ children }) {
  const desktop = isDesktop();
  const client = useMemo(() => createVaultClient(), []);
  const [phase, setPhase] = useState(desktop ? "starting" : "ready");
  const [opened, setOpened] = useState(!desktop);
  const [error, setError] = useState("");
  const [ai, setAi] = useState(null);
  const enter = () => { setOpened(true); setPhase("ready"); };
  const checkAi = async () => {
    const status = await client.localStatus();
    setAi(status);
    if ((status.state === "running" || status.state === "started") && status.model && status.models.some((m) => m === status.model || m === `${status.model}:latest`)) enter();
    else setPhase("setup");
  };
  const start = async () => {
    setError(""); setPhase("starting");
    try {
      await startDesktop();
      if (opened) { setPhase("ready"); return; }
      const { preferences } = await client.preferences();
      connection().preferences = preferences;
      if (preferences?.ai?.model === "cloud") enter();
      else await checkAi();
    } catch (e) { setError(String(e.message || e)); setPhase("failed"); }
  };
  useEffect(() => { if (desktop) start(); }, []); // startup is deduplicated across StrictMode mounts
  useEffect(() => {
    if (!desktop || phase !== "ready") return;
    let active = true;
    const timer = setInterval(async () => {
      try { await client.health(); }
      catch { if (active) { setError("The local engine stopped. Your open work is kept here while you reconnect."); setPhase("failed"); } }
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [desktop, phase, client]);
  useEffect(() => {
    const failed = (event) => setError(event.detail);
    window.addEventListener("kratt-settings-error", failed);
    return () => window.removeEventListener("kratt-settings-error", failed);
  }, []);
  if (!desktop) return children;
  const open = async (target) => { try { await openDesktop(target); } catch (e) { setError(String(e)); } };
  return <>
    {opened && <div hidden={phase !== "ready"}>{children}</div>}
    {phase !== "ready" && <main className="kratt-startup" aria-busy={phase === "starting"}>
      <div className="kratt-startup-sheet">
        <img src="/kratt.svg" alt="" width="64" height="64" />
        <h1>{phase === "starting" ? "Opening your Study folder…" : phase === "failed" ? "Kratt needs a moment" : "Meet your local study partner"}</h1>
        {phase === "starting" && <p>Starting the engine on this computer.</p>}
        {error && <p role="alert">{error}</p>}
        {phase === "failed" && <div className="kratt-startup-actions"><button className="kratt-startup-primary" onClick={start}>Retry</button><button onClick={() => open("logs")}>Open logs</button></div>}
        {phase === "setup" && <>
          <p>Your notes live in <strong>{connection()?.studyDir}</strong>. Continue to notes to choose an online AI in Settings → AI, or connect Ollama here to work locally.</p>
          {ai?.state === "not-installed" ? <><p>Ollama is not installed. Open its download page, install it, then come back to Kratt.</p><button onClick={() => open("ollama")}>Install Ollama</button></> : ai?.state === "failed" ? <p role="alert">Ollama could not start. {ai.detail}</p> : <>
            {!!ai?.models?.length && <label>Choose an installed model <select aria-label="Installed model" defaultValue="" onChange={async (e) => { try { await client.setLocalAi({ local: true, model: e.target.value }); await checkAi(); } catch (e) { setError(e.message); } }}>
              <option value="" disabled>Choose a model</option>{ai.models.map((name) => <option key={name}>{name}</option>)}
            </select></label>}
            <ModelDownload client={client} onDone={() => checkAi().catch((e) => setError(e.message))} />
          </>}
          <div className="kratt-startup-actions"><button onClick={() => checkAi().catch((e) => setError(e.message))}>Check again</button><button className="kratt-startup-primary" onClick={enter}>Continue to notes</button><button onClick={() => open("data")}>Show my files</button></div>
        </>}
      </div>
    </main>}
    {phase === "ready" && error && <aside className="kratt-desktop-notice" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></aside>}
  </>;
}
