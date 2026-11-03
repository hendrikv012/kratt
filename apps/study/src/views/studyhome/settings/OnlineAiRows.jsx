import { useEffect, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { openDesktop, openDesktopAuth } from "../../../desktop/runtime";
import { Row, Select } from "./controls";

const OPTIONS = [
  { value: "chatgpt", label: "ChatGPT subscription" },
  { value: "claude-code", label: "Claude subscription (Claude Code)" },
  { value: "openai", label: "OpenAI API" },
  { value: "anthropic", label: "Claude API" },
  { value: "compatible", label: "Other OpenAI-compatible API" },
];

export default function OnlineAiRows() {
  const client = useStudy()?.client;
  const [data, setData] = useState(null);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const choose = (name, settings = data) => {
    const profile = settings?.profiles?.[name] || {};
    setProvider(name); setModel(profile.model || ""); setBaseUrl(profile.baseUrl || ""); setKey(""); setModels([]); setNotice("");
  };
  useEffect(() => {
    let live = true;
    client?.aiSettings().then(value => { if (live) { setData(value); choose(value.provider, value); } }, e => live && setError(e.message));
    return () => { live = false; };
  }, [client]);
  useEffect(() => {
    if (!data?.chatgpt?.pending) return;
    const timer = setInterval(() => client.aiSettings().then(setData, e => setError(e.message)), 2000);
    return () => clearInterval(timer);
  }, [client, data?.chatgpt?.pending]);
  const run = async (work) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = async (extra = {}) => {
    const value = await client.saveAiSettings({ provider, model, ...(provider === "compatible" ? { baseUrl } : {}), ...(key ? { key } : {}), ...extra });
    setData(previous => ({ ...previous, ...value })); setKey("");
  };
  const refresh = async () => setData(await client.aiSettings());
  const signIn = async (accountId) => {
    await save();
    const result = await client.chatgptLogin(accountId);
    try { await openDesktopAuth(result.url); }
    catch (e) { await client.chatgptCancel(); throw e; }
    if (!accountId) { setModel(""); setModels([]); }
    await refresh();
  };
  const subscription = provider === "chatgpt" || provider === "claude-code";
  const account = data?.chatgpt || {};
  return <>
    <p className="st-set-note">When you ask Kratt, your question and selected note context are sent to the chosen provider. Your Study files stay on this computer. Provider usage limits and charges apply.</p>
    <Row label="Provider" htmlFor="st-ai-provider"><Select id="st-ai-provider" value={provider} options={OPTIONS} onChange={choose} disabled={busy || !data} /></Row>
    {provider === "compatible" && <Row label="API base URL" description="For example, your provider's HTTPS address ending in /v1. HTTP is allowed only on localhost." htmlFor="st-ai-base"><input className="st-input" id="st-ai-base" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></Row>}
    {!subscription && <>
      <Row label="API key" description="Saved in protected local app storage, outside your notes and browser settings. Subscription sign-in and API billing are separate." htmlFor="st-ai-secret"><input className="st-input" id="st-ai-secret" type="password" autoComplete="off" value={key} placeholder={data?.profiles?.[provider]?.keySet ? "A key is saved; enter one to replace it" : "Paste an API key"} onChange={e => setKey(e.target.value)} /></Row>
      {data?.profiles?.[provider]?.keySet && <button className="st-ghost-button" disabled={busy} onClick={() => run(async () => { await save({ key: null }); setNotice("API key removed."); })}>Remove API key</button>}
    </>}
    {provider === "chatgpt" && <>
      <p className="st-set-note">Use an eligible ChatGPT plan through OpenAI's browser sign-in. Available models and app usage depend on your account. Kratt does not use your ChatGPT password.</p>
      {!!account.accounts?.length && <Row label="ChatGPT account" htmlFor="st-chatgpt-account"><Select id="st-chatgpt-account" value={account.active || ""} options={account.accounts.map(a => ({ value: a.id, label: a.label }))} onChange={id => run(async () => { await client.chatgptSelect(id); setModel(""); setModels([]); await refresh(); })} disabled={busy} /></Row>}
      <div className="st-row">
        <button className="st-button" disabled={busy || account.pending} onClick={() => run(() => signIn(account.active || null))}>Continue with ChatGPT</button>
        {!!account.accounts?.length && <button className="st-ghost-button" disabled={busy || account.pending} onClick={() => run(() => signIn(null))}>Add another account</button>}
        {account.pending && <button className="st-ghost-button" disabled={busy} onClick={() => run(async () => { await client.chatgptCancel(); await refresh(); })}>Cancel sign-in</button>}
        {account.signedIn && <button className="st-ghost-button" disabled={busy} onClick={() => run(async () => { await client.chatgptLogout(); await refresh(); })}>Sign out of ChatGPT</button>}
        <button className="st-ghost-button" onClick={() => run(() => openDesktop("chatgpt-usage"))}>ChatGPT usage</button>
      </div>
      <p className="st-set-note" role="status">{account.message || (account.signedIn ? "Signed in. Load models, then choose one." : "Not connected to ChatGPT.")}</p>
    </>}
    {provider === "claude-code" && <>
      <p className="st-set-note">Uses the official Claude Code app on this computer with your Claude subscription. Kratt sends only the prepared prompt, with tools disabled. Your plan's limits apply.</p>
      <div className="st-row">
        {!data?.claudeInstalled ? <button className="st-button" onClick={() => run(() => openDesktop("claude"))}>Get Claude Code</button> : <button className="st-button" disabled={busy} onClick={() => run(async () => { await save(); await client.claudeLogin(); setNotice("Finish Claude sign-in in your browser, then check the connection."); })}>Sign in to Claude</button>}
        <button className="st-ghost-button" disabled={busy} onClick={() => run(async () => { const status = await client.claudeStatus(); await refresh(); setNotice(status.signedIn ? "Claude subscription is connected." : "Claude Code is not signed in to a subscription yet."); })}>Check Claude connection</button>
      </div>
    </>}
    <Row label="Model" description="Load the provider's models, or enter an exact model ID. Save after choosing." htmlFor="st-online-model"><input id="st-online-model" className="st-input" list="st-online-models" value={model} onChange={e => setModel(e.target.value)} placeholder={provider === "claude-code" ? "sonnet" : "Model ID"} /><datalist id="st-online-models">{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist></Row>
    <div className="st-row">
      <button className="st-button" disabled={busy || !data} onClick={() => run(async () => { await save(); setNotice("AI provider saved."); })}>Save AI provider</button>
      <button className="st-ghost-button" disabled={busy || !data} onClick={() => run(async () => { await save(); const result = await client.aiModels(); setModels(result.models); setNotice(`${result.models.length} models loaded. Choose a model, then save.`); })}>Load models</button>
    </div>
    {notice && <p className="st-set-note" role="status">{notice}</p>}
    {error && <p className="st-set-note" role="alert">{error}</p>}
  </>;
}
