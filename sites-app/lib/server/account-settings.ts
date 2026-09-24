import type { D1Database } from "./cache-database.ts";
import { getCacheDatabase } from "./cache-database.ts";
import { readRateLimitUsageForUser } from "./scaling-protection.ts";

export type AccountUser = {
  userId: string;
  email: string;
  displayName: string;
};

export type AiProvider = "openrouter" | "groq";

export type AccountProviderStatus = {
  configured: boolean;
  model: string;
};

type CredentialRow = {
  provider: AiProvider;
  model: string;
  key_ciphertext: string;
  key_iv: string;
};

const AUTH_ID = "oai-authenticated-user-id";
const AUTH_EMAIL = "oai-authenticated-user-email";
const AUTH_NAME = "oai-authenticated-user-full-name";
const AUTH_NAME_ENCODING = "oai-authenticated-user-full-name-encoding";
const PROVIDERS: AiProvider[] = ["openrouter", "groq"];

export function accountUserFromRequest(request: Request): AccountUser | null {
  const userId = request.headers.get(AUTH_ID)?.trim();
  const email = request.headers.get(AUTH_EMAIL)?.trim();
  if (!userId || !email) return null;
  const encodedName = request.headers.get(AUTH_NAME);
  const displayName = encodedName && request.headers.get(AUTH_NAME_ENCODING) === "percent-encoded-utf-8"
    ? safeDecode(encodedName) ?? email
    : email;
  return { userId, email, displayName };
}

export function isAiProvider(value: string | null | undefined): value is AiProvider {
  return PROVIDERS.includes(value as AiProvider);
}

export async function readAccount(user: AccountUser) {
  const db = await requiredDatabase();
  await upsertProfile(db, user);
  const profile = await db.prepare(`
    SELECT preferred_ai_provider FROM user_profiles WHERE user_id = ?
  `).bind(user.userId).first<{ preferred_ai_provider: AiProvider }>();
  const credentials = await db.prepare(`
    SELECT provider, model FROM user_ai_credentials WHERE user_id = ?
  `).bind(user.userId).all<{ provider: AiProvider; model: string }>();
  const favorites = await db.prepare(`
    SELECT ticker, created_at FROM favorite_stocks WHERE user_id = ? ORDER BY created_at DESC
  `).bind(user.userId).all<{ ticker: string; created_at: string }>();
  const limits = await readRateLimitUsageForUser(user.userId);
  const providers: Record<AiProvider, AccountProviderStatus> = {
    openrouter: { configured: false, model: "" },
    groq: { configured: false, model: "" },
  };
  for (const credential of credentials.results ?? []) {
    if (isAiProvider(credential.provider)) providers[credential.provider] = { configured: true, model: credential.model };
  }
  return {
    user: { email: user.email, displayName: user.displayName },
    preferredProvider: isAiProvider(profile?.preferred_ai_provider) ? profile.preferred_ai_provider : "openrouter",
    providers,
    favorites: favorites.results ?? [],
    limits,
  };
}

export async function saveAccountProvider(input: {
  user: AccountUser;
  provider: AiProvider;
  model: string;
  apiKey?: string;
}) {
  const db = await requiredDatabase();
  await upsertProfile(db, input.user);
  const now = new Date().toISOString();
  const existing = await db.prepare(`
    SELECT provider FROM user_ai_credentials WHERE user_id = ? AND provider = ?
  `).bind(input.user.userId, input.provider).first();
  if (!existing && !input.apiKey) throw new Error("An API key is required for a new provider.");

  if (input.apiKey) {
    const encrypted = await encryptSecret(input.apiKey);
    await db.prepare(`
      INSERT INTO user_ai_credentials (
        user_id, provider, model, key_ciphertext, key_iv, key_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET
        model=excluded.model, key_ciphertext=excluded.key_ciphertext,
        key_iv=excluded.key_iv, key_version=1, updated_at=excluded.updated_at
    `).bind(input.user.userId, input.provider, input.model, encrypted.ciphertext, encrypted.iv, now, now).run();
  } else {
    await db.prepare(`
      UPDATE user_ai_credentials SET model = ?, updated_at = ?
      WHERE user_id = ? AND provider = ?
    `).bind(input.model, now, input.user.userId, input.provider).run();
  }

  await db.prepare(`
    UPDATE user_profiles SET preferred_ai_provider = ?, updated_at = ? WHERE user_id = ?
  `).bind(input.provider, now, input.user.userId).run();
}

export async function removeAccountProvider(userId: string, provider: AiProvider) {
  const db = await requiredDatabase();
  await db.prepare(`DELETE FROM user_ai_credentials WHERE user_id = ? AND provider = ?`)
    .bind(userId, provider).run();
}

export async function saveFavorite(user: AccountUser, ticker: string) {
  const db = await requiredDatabase();
  await upsertProfile(db, user);
  await db.prepare(`
    INSERT INTO favorite_stocks (user_id, ticker, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, ticker) DO NOTHING
  `).bind(user.userId, ticker, new Date().toISOString()).run();
}

export async function removeFavorite(userId: string, ticker: string) {
  const db = await requiredDatabase();
  await db.prepare(`DELETE FROM favorite_stocks WHERE user_id = ? AND ticker = ?`)
    .bind(userId, ticker).run();
}

export async function accountResearchConfig(request: Request, selected?: string) {
  const user = accountUserFromRequest(request);
  if (!user || !isAiProvider(selected)) return null;
  const db = await getCacheDatabase();
  if (!db) return null;
  const row = await db.prepare(`
    SELECT provider, model, key_ciphertext, key_iv
    FROM user_ai_credentials WHERE user_id = ? AND provider = ?
  `).bind(user.userId, selected).first<CredentialRow>();
  if (!row?.model || !row.key_ciphertext || !row.key_iv) return null;
  const key = await decryptSecret(row.key_ciphertext, row.key_iv);
  return {
    provider: row.provider,
    key,
    model: row.model,
    endpoint: row.provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions",
    scope: "account" as const,
  };
}

async function upsertProfile(db: D1Database, user: AccountUser) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO user_profiles (user_id, email, display_name, preferred_ai_provider, created_at, updated_at)
    VALUES (?, ?, ?, 'openrouter', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at
  `).bind(user.userId, user.email, user.displayName, now, now).run();
}

async function requiredDatabase() {
  const db = await getCacheDatabase();
  if (!db) throw new Error("Account storage is unavailable.");
  return db;
}

async function encryptionKey() {
  const raw = await accountSecret();
  if (!raw) throw new Error("Account key storage is unavailable.");
  const bytes = decodeBase64(raw);
  if (bytes.byteLength !== 32) throw new Error("Account key storage is unavailable.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function accountSecret() {
  const localSecret = typeof process === "undefined" ? null : process.env.ACCOUNT_SECRETS_KEY?.trim() || null;
  try {
    const { env } = await import("cloudflare:workers") as unknown as { env: Record<string, string | undefined> };
    return env.ACCOUNT_SECRETS_KEY?.trim() || localSecret;
  } catch {
    return localSecret;
  }
}

async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return { ciphertext: encodeBase64(new Uint8Array(ciphertext)), iv: encodeBase64(iv) };
}

async function decryptSecret(ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(iv) },
    await encryptionKey(),
    decodeBase64(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
