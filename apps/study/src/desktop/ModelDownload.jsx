import { useEffect, useState } from "react";

export default function ModelDownload({ client, onDone }) {
  const [model, setModel] = useState("llama3.2:3b");
  const [progress, setProgress] = useState({ state: "idle" });
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const value = await client.pullStatus();
        if (!stopped) setProgress(value);
      } catch { /* The startup screen reports engine disconnections. */ }
    };
    check();
    const timer = setInterval(check, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [client]);
  const download = async () => {
    setError("");
    try { setProgress(await client.pullModel(model.trim())); }
    catch (e) { setError(e.message); }
  };
  const choose = async () => {
    try { await client.setLocalAi({ model: progress.model, local: true }); onDone?.(); }
    catch (e) { setError(e.message); }
  };
  return <div className="kratt-model-download">
    <p>Download a model to use AI offline. This uses your internet connection and may take several gigabytes of disk space.</p>
    <label>Ollama model <input className="st-input" value={model} onChange={(e) => setModel(e.target.value)} disabled={progress.state === "downloading"} /></label>
    <button className="st-ghost-button" onClick={download} disabled={!model.trim() || progress.state === "downloading"}>Download model</button>
    <p role="status">{progress.state === "downloading" ? `${progress.detail}${progress.total ? ` · ${Math.round(progress.completed / progress.total * 100)}%` : ""}` : progress.state === "failed" ? progress.detail : progress.state === "done" ? `${progress.model} is downloaded.` : ""}</p>
    {progress.state === "done" && <button className="st-ghost-button" onClick={choose}>Use downloaded model</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
