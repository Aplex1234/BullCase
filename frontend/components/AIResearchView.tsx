"use client";
import { useEffect, useRef, useState } from "react";
import Add from "@carbon/icons-react/es/Add.js";
import ArrowUp from "@carbon/icons-react/es/ArrowUp.js";
import ArrowUpRight from "@carbon/icons-react/es/ArrowUpRight.js";
import Close from "@carbon/icons-react/es/Close.js";
import { prepareResearchConversation } from "../lib/research-chat";
import { readResearchResponse } from "../lib/research-stream";
import { ResearchAnswer } from "./ResearchAnswer";
import { ResearchComposerGlow, ResearchThinking, ResearchWelcomeOrb } from "./ResearchEffects";

type Provider = "openrouter" | "groq" | "google";
type Connection = { key: string; model: string };
type Source = { id: string; title: string; url: string; date: string | null };
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };
const names = { openrouter: "OpenRouter", groq: "Groq", google: "Google AI Studio" };
const defaults = { openrouter: "", groq: "openai/gpt-oss-120b", google: "" };
function safeSource(source: Source) {
  try { const url = new URL(source.url); return url.protocol === "https:" && (url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov")); } catch { return false; }
}

export function AIResearchView({ ticker, companyName = ticker }: { ticker: string; companyName?: string }) {
  const displayName = companyName.replace(/,?\s+(?:incorporated|inc\.?|corporation|corp\.?|limited|ltd\.?|plc)\s*$/i, "").trim() || companyName;
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [keys, setKeys] = useState<Partial<Record<Provider, Connection>>>({});
  const [draftProvider, setDraftProvider] = useState<Provider>("openrouter");
  const [draftKey, setDraftKey] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [streamed, setStreamed] = useState("");
  const [server, setServer] = useState<{ provider: Provider; configured: boolean; model?: string; scope?: "account" | "shared" | null } | null>(null);
  const active = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const connection = keys[provider];
  const ready = !!connection || (server?.provider === provider && server.configured);
  const prompts = [
    { label: "Growth", short: "Revenue over 3 years", question: `How has ${displayName}'s revenue grown over the last three years?` },
    { label: "Profitability", short: "Margin trends", question: `What changed in ${displayName}'s operating margins?` },
    { label: "Cash flow", short: "Earnings into cash", question: `How well does ${displayName} turn its earnings into free cash flow?` },
    { label: "Risk", short: "Disclosed risks", question: `What are the most important disclosed risks for ${displayName}?` },
  ];
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/companies/${encodeURIComponent(ticker)}/research?provider=${provider}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(async response => { if (!response.ok) throw new Error(); const result = await response.json(); if (!controller.signal.aborted) setServer({ provider, configured: result.configured === true, model: result.model, scope: result.scope }); })
      .catch(() => { if (!controller.signal.aborted) setServer({ provider, configured: false }); });
    return () => controller.abort();
  }, [ticker, provider]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, busy, streamed]);
  function openSettings() { setDraftProvider(provider); setDraftKey(keys[provider]?.key ?? ""); setDraftModel(keys[provider]?.model ?? defaults[provider]); setShowKey(false); dialog.current?.showModal(); }
  function closeSettings() { dialog.current?.close(); setDraftKey(""); setShowKey(false); }
  function reset() { active.current?.abort(); active.current = null; setBusy(false); setPending(""); setMessages([]); setError(""); setNotice(""); setQuestion(""); composer.current?.focus(); }
  async function send() {
    if (!question.trim() || active.current) return;
    if (!ready) { openSettings(); return; }
    const controller = new AbortController(); active.current = controller;
    const submitted = question.trim();
    setBusy(true); setPending(submitted); setStreamed(""); setError(""); setNotice(""); setQuestion("");
    try {
      const conversation = prepareResearchConversation(messages, submitted);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(75000)]);
      const response = await fetch(`/api/v1/companies/${encodeURIComponent(ticker)}/research?provider=${provider}`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, cache: "no-store",
        signal,
        body: JSON.stringify({ messages: conversation.messages, ...(connection ? { connection } : {}) }),
      });
      const result = await readResearchResponse(response, signal, answer => { if (active.current === controller) setStreamed(answer); });
      if (controller.signal.aborted) return;
      setMessages([...messages, { role: "user", content: submitted }, { role: "assistant", content: result.answer, sources: result.sources }]);
      if (result.truncated) setNotice("Answer length limit reached. Ask a focused follow-up.");
      else if (conversation.omittedMessages) setNotice("Only recent exchanges were included in this answer.");
    } catch (reason) {
      if (!controller.signal.aborted) { setQuestion(submitted); setError(reason instanceof Error && reason.name !== "TimeoutError" && reason.name !== "SyntaxError" ? reason.message : "The request timed out or was interrupted. Try again."); }
    } finally { if (active.current === controller) { setBusy(false); setPending(""); active.current = null; composer.current?.focus(); } }
  }
  function stop(event: { preventDefault(): void }) { event.preventDefault(); active.current?.abort(); active.current = null; setQuestion(pending); setPending(""); setBusy(false); setNotice("Response stopped."); }
  return <div className="page-stack research-chat-page"><ResearchComposerGlow busy={busy} frame><section className="research-chat" data-empty={!messages.length && !busy} data-thinking={busy} aria-label={`${ticker} AI Research`}>
    <header className="research-chat-header"><div className="research-chat-title"><div><h2>AI Research</h2><span>{displayName}</span></div></div><div className="research-chat-actions"><button type="button" onClick={reset} aria-label="Start a new chat"><Add size={18} /><span>New chat</span></button></div></header>
    <div className="research-chat-log" ref={log} role="log" aria-label="Research conversation" aria-live="polite" aria-busy={busy}>
      {!messages.length && !busy && <div className="research-chat-empty"><ResearchWelcomeOrb /><h3>Let’s explore {displayName}.</h3><div className="research-suggestions">{prompts.map(prompt => <button key={prompt.label} type="button" title={prompt.question} onClick={() => { setQuestion(prompt.question); setError(""); composer.current?.focus(); }}><span>{prompt.label}<ArrowUpRight size={14} /></span></button>)}</div></div>}
      {messages.map((message, index) => <article key={index} className={`research-message research-message-${message.role}`}><span className="research-message-author">{message.role === "user" ? "You" : "BullCase Research"}</span><div className="research-message-text">{message.role === "assistant" ? <ResearchAnswer content={message.content} /> : <p>{message.content}</p>}</div>{!!message.sources?.filter(safeSource).length && <div className="research-sources">{message.sources.filter(safeSource).map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>{source.id}</span>{source.title}<ArrowUpRight size={14} /></a>)}</div>}</article>)}
      {busy && <><article className="research-message research-message-user"><span className="research-message-author">You</span><div className="research-message-text"><p>{pending}</p></div></article>{streamed ? <article className="research-message research-message-assistant"><span className="research-message-author">BullCase Research</span><div className="research-message-text"><ResearchAnswer content={streamed} /></div></article> : <ResearchThinking />}</>}
    </div>
    <div className="research-compose-area">{error && <div className="research-chat-error" role="alert">{error}</div>}{notice && <p className="research-chat-notice" role="status">{notice}</p>}
      <ResearchComposerGlow busy={busy}><form className="research-composer" onSubmit={event => { event.preventDefault(); void send(); }}><label className="visually-hidden" htmlFor="research-question">Ask about {displayName}</label><textarea ref={composer} id="research-question" value={question} maxLength={2000} rows={2} disabled={busy} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={`Ask about ${displayName}…`} /><div className="research-composer-tools"><button className="research-provider-button" type="button" onClick={openSettings} disabled={busy}>{ready ? `${names[provider]}${!connection && server?.scope === "account" ? " · Account" : ""}` : "Add API key"}</button>{busy ? <button type="button" className="research-send" onClick={stop} aria-label="Stop response"><span className="research-stop-square" /></button> : <button className="research-send" type="submit" disabled={!question.trim()} aria-label={ready ? "Send question" : "Add API key to send"}><ArrowUp size={20} /></button>}</div></form></ResearchComposerGlow>
    </div>
  </section></ResearchComposerGlow>
  <dialog className="research-key-dialog" ref={dialog} onCancel={() => { setDraftKey(""); setShowKey(false); }} aria-labelledby="research-key-title"><header><div><span className="research-eyebrow">CONNECTION</span><h2 id="research-key-title">Your API keys</h2></div><button type="button" onClick={closeSettings} aria-label="Close API settings"><Close size={20} /></button></header>
    <form onSubmit={event => { event.preventDefault(); setKeys(current => ({ ...current, [draftProvider]: { key: draftKey.trim(), model: draftModel.trim() } })); setProvider(draftProvider); setError(""); closeSettings(); composer.current?.focus(); }}>
      <label htmlFor="research-provider">Provider</label><select id="research-provider" value={draftProvider} onChange={event => { const next = event.target.value as Provider; setDraftProvider(next); setDraftKey(keys[next]?.key ?? ""); setDraftModel(keys[next]?.model ?? defaults[next]); setShowKey(false); }}><option value="openrouter">OpenRouter</option><option value="groq">Groq</option><option value="google">Google AI Studio</option></select>
      <div className="research-field-heading"><label htmlFor="research-api-key">API key</label><a href={draftProvider === "openrouter" ? "https://openrouter.ai/settings/keys" : draftProvider === "groq" ? "https://console.groq.com/keys" : "https://aistudio.google.com/api-keys"} target="_blank" rel="noreferrer">Get a key <ArrowUpRight size={13} /></a></div><div className="research-key-input"><input id="research-api-key" type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} value={draftKey} minLength={12} maxLength={512} required onChange={event => setDraftKey(event.target.value)} /><button type="button" onClick={() => setShowKey(value => !value)} aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? "Hide" : "Show"}</button></div>
      <label htmlFor="research-model">Model <span>{draftProvider === "openrouter" ? "(optional)" : ""}</span></label><input id="research-model" value={draftModel} maxLength={150} required={draftProvider !== "openrouter"} placeholder={draftProvider === "openrouter" ? "Use your OpenRouter default" : draftProvider === "google" ? "Gemini model ID" : "Model ID"} autoComplete="off" spellCheck={false} onChange={event => setDraftModel(event.target.value)} />
      <p className="research-key-note">This dialog uses the key for this chat only. Save OpenRouter or Groq across devices in Account, under AI providers. Your key and chat are sent through BullCase to {names[draftProvider]}. Provider charges apply.</p><div className="research-key-footer">{keys[draftProvider] && <button type="button" onClick={() => { setKeys(current => { const next = { ...current }; delete next[draftProvider]; return next; }); setDraftKey(""); }}>Remove key</button>}<button className="research-key-save" type="submit">Use this key</button></div>
    </form>
  </dialog></div>;
}
