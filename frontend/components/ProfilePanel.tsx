"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark.js";
import Close from "@carbon/icons-react/es/Close.js";
import Favorite from "@carbon/icons-react/es/Favorite.js";
import Login from "@carbon/icons-react/es/Login.js";
import Logout from "@carbon/icons-react/es/Logout.js";
import Moon from "@carbon/icons-react/es/Moon.js";
import Password from "@carbon/icons-react/es/Password.js";
import Sun from "@carbon/icons-react/es/Sun.js";
import TrashCan from "@carbon/icons-react/es/TrashCan.js";
import UserAvatar from "@carbon/icons-react/es/UserAvatar.js";
import { useEffect, useId, useRef, useState } from "react";

import type { TerminalTheme } from "@/hooks/useTerminalTheme";
import type { AccountIdentity, AccountProvider, AccountSnapshot } from "../lib/account";

type PanelPage = "profile" | "favorites" | "ai" | "appearance";

export function ProfilePanel({ theme, onToggleTheme, account, signInPath, signOutPath, onSelectCompany }: {
  theme: TerminalTheme;
  onToggleTheme: () => void;
  account: AccountIdentity | null;
  signInPath: string;
  signOutPath: string;
  onSelectCompany: (ticker: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [page, setPage] = useState<PanelPage>("profile");
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open || !account) return;
    const controller = new AbortController();
    setLoadError("");
    setLoading(true);
    void fetch("/api/v1/account", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as AccountSnapshot & { detail?: string };
        if (!response.ok) throw new Error(result.detail || "Account settings are unavailable.");
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Account settings are unavailable.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account, open, reload]);

  function openPanel() {
    setPage("profile");
    dialog.current?.showModal();
    setOpen(true);
  }

  function openFavorites() {
    setPage("favorites");
  }

  function selectFavorite(ticker: string) {
    dialog.current?.close();
    onSelectCompany(ticker);
  }

  return <>
    <button ref={trigger} type="button" className="profile-trigger" aria-haspopup="dialog" aria-label="Open profile and settings" title="Profile and settings"
      aria-expanded={open} aria-controls={id} onClick={openPanel}>
      <UserAvatar size={24} aria-hidden="true" />
    </button>
    <dialog ref={dialog} id={id} className="profile-dialog" aria-labelledby={`${id}-title`}
      onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <div className="profile-dialog-heading">
        <h2 id={`${id}-title`}>Account</h2>
        <button type="button" className="profile-close" aria-label="Close profile and settings" onClick={() => dialog.current?.close()}><Close size={20} aria-hidden="true" /></button>
      </div>
      <nav className="profile-sections" aria-label="Account sections">
        <button type="button" aria-current={page === "profile" ? "page" : undefined} onClick={() => setPage("profile")}>Profile</button>
        <button type="button" aria-current={page === "favorites" ? "page" : undefined} onClick={() => setPage("favorites")}>Favorites</button>
        <button type="button" aria-current={page === "ai" ? "page" : undefined} onClick={() => setPage("ai")}>AI providers</button>
        <button type="button" aria-current={page === "appearance" ? "page" : undefined} onClick={() => setPage("appearance")}>Appearance</button>
      </nav>
      <div className="profile-content">
        {page === "profile" && <ProfilePage account={account} snapshot={snapshot} error={loadError} loading={loading} onRetry={() => setReload((value) => value + 1)} signInPath={signInPath} signOutPath={signOutPath} onOpenFavorites={openFavorites} />}
        {page === "favorites" && <FavoritesSettings account={account} snapshot={snapshot} error={loadError} signInPath={signInPath} onSelectCompany={selectFavorite} onRetry={() => setReload((value) => value + 1)} />}
        {page === "ai" && <AiSettings account={account} snapshot={snapshot} error={loadError} signInPath={signInPath} onSaved={setSnapshot} onRetry={() => setReload((value) => value + 1)} />}
        {page === "appearance" && <AppearanceSettings theme={theme} onToggleTheme={onToggleTheme} />}
      </div>
    </dialog>
  </>;
}

function ProfilePage({ account, snapshot, error, loading, onRetry, signInPath, signOutPath, onOpenFavorites }: {
  account: AccountIdentity | null;
  snapshot: AccountSnapshot | null;
  error: string;
  loading: boolean;
  onRetry: () => void;
  signInPath: string;
  signOutPath: string;
  onOpenFavorites: () => void;
}) {
  if (!account) return <section className="account-guest">
    <UserAvatar size={36} aria-hidden="true" />
    <h3>Sign in to personalize AplexAnalysis</h3>
    <p>Keep provider keys and favorite stocks attached to one private account.</p>
    <a className="account-primary-action" href={signInPath} target="_top"><Login size={18} aria-hidden="true" />Sign in with ChatGPT</a>
  </section>;

  const providers = snapshot ? Object.values(snapshot.providers).filter((provider) => provider.configured).length : null;
  return <section>
    <div className="account-identity"><span aria-hidden="true">{initials(account.displayName)}</span><div><h3>{account.displayName}</h3><p>{account.email}</p></div></div>
    <div className="account-summary">
      <button type="button" onClick={onOpenFavorites}><Favorite size={20} aria-hidden="true" /><span>Favorites<small>{snapshot ? `${snapshot.favorites.length} saved` : "Loading"}</small></span></button>
      <div><Password size={20} aria-hidden="true" /><span>AI providers<small>{providers == null ? "Loading" : `${providers} connected`}</small></span></div>
    </div>
    <div className="account-usage-heading"><div><h3>Current usage</h3><p>Limits reset automatically. Times use your timezone.</p></div><button type="button" onClick={onRetry} disabled={loading}>{loading ? "Updating" : "Update"}</button></div>
    {error && <p className="account-form-error" role="alert">{error}</p>}
    {snapshot?.limits ? <div className="account-usage-list">
      {snapshot.limits.buckets.map((bucket) => <div className="account-usage-row" key={bucket.kind}>
        <div><strong>{usageLabel(bucket.kind)}</strong>{bucket.kind === "ai-research-shared" && <small>Site-wide</small>}</div>
        <div><strong>{bucket.used} / {bucket.limit} used</strong><small>{bucket.remaining} left in this limit · resets {formatResetTime(bucket.resetsAt)}</small></div>
      </div>)}
      <p>Searches and manual refreshes also use the data request limit, so the lower remaining count applies. Shared AI capacity applies to everyone.</p>
    </div> : !error && <p className="account-usage-pending" role="status">Loading usage…</p>}
    <a className="account-signout" href={signOutPath} target="_top"><Logout size={18} aria-hidden="true" />Sign out</a>
  </section>;
}

function FavoritesSettings({ account, snapshot, error, signInPath, onSelectCompany, onRetry }: {
  account: AccountIdentity | null;
  snapshot: AccountSnapshot | null;
  error: string;
  signInPath: string;
  onSelectCompany: (ticker: string) => void;
  onRetry: () => void;
}) {
  if (!account) return <section className="account-guest">
    <Favorite size={36} aria-hidden="true" />
    <h3>Save companies to your profile</h3>
    <p>Sign in to keep a personal stock list across devices.</p>
    <a className="account-primary-action" href={signInPath} target="_top"><Login size={18} aria-hidden="true" />Sign in with ChatGPT</a>
  </section>;
  if (error) return <section><h3>Favorites</h3><p className="account-form-error" role="alert">{error}</p><button type="button" className="account-secondary-action" onClick={onRetry}>Try again</button></section>;
  if (!snapshot) return <section className="account-settings-loading" aria-live="polite"><span /><span /><span /></section>;

  return <section className="account-favorites">
    <div className="account-favorites-heading"><div><h3>Favorites</h3><p>Companies saved with the heart button.</p></div><span>{snapshot.favorites.length} saved</span></div>
    {snapshot.favorites.length ? <div className="account-favorite-list">
      {snapshot.favorites.map((favorite) => <button type="button" key={favorite.ticker} onClick={() => onSelectCompany(favorite.ticker)}>
        <Favorite size={18} aria-hidden="true" /><strong>{favorite.ticker}</strong><small>Open overview</small>
      </button>)}
    </div> : <div className="account-favorites-empty"><Favorite size={28} aria-hidden="true" /><h4>No favorites yet</h4><p>Use the heart beside your profile while viewing a company.</p></div>}
  </section>;
}

function AiSettings({ account, snapshot, error, signInPath, onSaved, onRetry }: {
  account: AccountIdentity | null;
  snapshot: AccountSnapshot | null;
  error: string;
  signInPath: string;
  onSaved: (value: AccountSnapshot) => void;
  onRetry: () => void;
}) {
  const [provider, setProvider] = useState<AccountProvider>("openrouter");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!snapshot) return;
    const preferred = snapshot.preferredProvider;
    setProvider(preferred);
    setModel(snapshot.providers[preferred].model);
  }, [snapshot]);

  if (!account) return <section className="account-guest"><Password size={36} aria-hidden="true" /><h3>Save provider keys to your account</h3><p>Keys are encrypted before storage and are never sent to the browser again.</p><a className="account-primary-action" href={signInPath} target="_top"><Login size={18} aria-hidden="true" />Sign in with ChatGPT</a></section>;
  if (error) return <section><h3>AI provider settings</h3><p className="account-form-error" role="alert">{error}</p><button type="button" className="account-secondary-action" onClick={onRetry}>Try again</button></section>;
  if (!snapshot) return <section className="account-settings-loading" aria-live="polite"><span /><span /><span /></section>;

  const configured = snapshot.providers[provider].configured;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!model.trim() || (!configured && !apiKey.trim())) return;
    setSaving(true); setStatus(""); setFormError("");
    try {
      const response = await fetch("/api/v1/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: model.trim(), apiKey: apiKey.trim() || undefined }),
      });
      const result = await response.json() as AccountSnapshot & { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Could not save provider settings.");
      onSaved(result); setApiKey(""); setStatus("Saved to your account.");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not save provider settings.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true); setStatus(""); setFormError("");
    try {
      const response = await fetch(`/api/v1/account?provider=${provider}`, { method: "DELETE" });
      const result = await response.json() as AccountSnapshot & { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Could not remove the provider key.");
      onSaved(result); setApiKey(""); setModel(""); setStatus("Provider key removed.");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not remove the provider key.");
    } finally {
      setSaving(false);
    }
  }

  return <section>
    <h3>AI provider settings</h3>
    <p>Use your own OpenRouter or Groq account for AI Research.</p>
    <form className="account-provider-form" onSubmit={save}>
      <label>Provider<select value={provider} disabled={saving} onChange={(event) => { const next = event.target.value as AccountProvider; setProvider(next); setModel(snapshot.providers[next].model); setApiKey(""); setStatus(""); setFormError(""); }}><option value="openrouter">OpenRouter</option><option value="groq">Groq</option></select></label>
      <label>Model<input value={model} disabled={saving} maxLength={200} autoComplete="off" onChange={(event) => setModel(event.target.value)} placeholder={provider === "openrouter" ? "Provider model ID" : "Groq model ID"} /></label>
      <label>API key<input type="password" value={apiKey} disabled={saving} maxLength={4096} autoComplete="new-password" onChange={(event) => setApiKey(event.target.value)} placeholder={configured ? "Leave blank to keep saved key" : "Paste API key"} /></label>
      <small>Stored encrypted. The saved key cannot be viewed after submission.</small>
      {formError && <p className="account-form-error" role="alert">{formError}</p>}
      {status && <p className="account-form-success" role="status"><Checkmark size={16} aria-hidden="true" />{status}</p>}
      <div className="account-form-actions"><button type="submit" className="account-primary-action" disabled={saving || !model.trim() || (!configured && !apiKey.trim())}>{saving ? "Saving" : configured ? "Update" : "Save provider"}</button>{configured && <button type="button" className="account-danger-action" disabled={saving} onClick={() => void remove()}><TrashCan size={17} aria-hidden="true" />Remove key</button>}</div>
    </form>
  </section>;
}

function AppearanceSettings({ theme, onToggleTheme }: { theme: TerminalTheme; onToggleTheme: () => void }) {
  return <section><h3>Appearance</h3><p>Choose how the research workspace looks on this browser.</p><fieldset className="appearance-options"><legend className="sr-only">Color theme</legend>{(["light", "dark"] as const).map((option) => <label key={option}><input type="radio" name="account-theme" value={option} checked={theme === option} onChange={() => { if (theme !== option) onToggleTheme(); }} />{option === "light" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}{option === "light" ? "Light" : "Dark"}</label>)}</fieldset><p className="profile-note">Theme stays on this device. Account data does not include browsing history or research chats.</p></section>;
}

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)?.[0] ?? ""}` : words[0]?.slice(0, 2) || "AA").toUpperCase();
}

function usageLabel(kind: AccountSnapshot["limits"]["buckets"][number]["kind"]) {
  return {
    general: "Data requests",
    search: "Searches",
    "manual-refresh": "Manual refreshes",
    "cold-build": "New analyses",
    "ai-research": "AI Research",
    "ai-research-shared": "Shared AI Research",
  }[kind];
}

function formatResetTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}
