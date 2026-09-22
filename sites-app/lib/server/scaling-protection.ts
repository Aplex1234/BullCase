import {
  acquireCacheRefreshLease,
  getCacheDatabase,
  releaseCacheRefreshLease,
} from "./analysis-cache.ts";
import {
  MemoryFixedWindowCounter,
  coordinateColdBuild,
  reservePacedSlot,
} from "./scaling-core.ts";

export { ColdBuildBusyError } from "./scaling-core.ts";

const BUILD_RESULT_TTL_MS = 60_000;
const BUILD_LEASE_MS = 90_000;
const SEC_BUDGET_PER_SECOND = 8;
const SEC_BUDGET_WAIT_MS = 12_000;
const SEC_REQUEST_INTERVAL_MS = Math.ceil(1_000 / SEC_BUDGET_PER_SECOND);
const TRUSTED_CLIENT_KEY_HEADER = "x-aplex-edge-client-key";
const localCounters = new MemoryFixedWindowCounter();
let localSecNextAvailableAt = 0;
let cleanupSequence = 0;

export type RequestLimitKind = "general" | "manual-refresh" | "cold-build";

const REQUEST_LIMITS: Record<RequestLimitKind, { limit: number; windowMs: number }> = {
  general: { limit: 50, windowMs: 60_000 },
  "manual-refresh": { limit: 5, windowMs: 60 * 60_000 },
  "cold-build": { limit: 10, windowMs: 60_000 },
};

export class RequestRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(kind: RequestLimitKind, retryAfterSeconds: number) {
    const message = kind === "manual-refresh"
      ? "Manual refresh limit reached. Please try again later."
      : kind === "cold-build"
        ? "Too many new analyses were requested. Please retry shortly."
        : "Too many requests. Please retry shortly.";
    super(message);
    this.name = "RequestRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function bucketKey(namespace: string, identity: string, windowMs: number, now: number) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return `${namespace}:${identity}:${windowStart}`;
}

async function consumeFixedWindow(namespace: string, identity: string, limit: number, windowMs: number, now = Date.now()) {
  const counterKey = bucketKey(namespace, identity, windowMs, now);
  const expiresAt = Math.floor(now / windowMs) * windowMs + windowMs;
  try {
    const db = await getCacheDatabase();
    if (db) {
      const result = await db.prepare(`
        INSERT INTO request_rate_limits (counter_key, request_count, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(counter_key) DO UPDATE SET request_count=request_rate_limits.request_count + 1
        WHERE request_rate_limits.request_count < ?
      `).bind(counterKey, new Date(expiresAt).toISOString(), limit).run();
      cleanupSequence += 1;
      if (cleanupSequence % 256 === 0) {
        const timestamp = new Date(now).toISOString();
        await db.batch([
          db.prepare(`DELETE FROM request_rate_limits WHERE expires_at <= ?`).bind(timestamp),
          db.prepare(`DELETE FROM scaling_build_results WHERE expires_at <= ?`).bind(timestamp),
        ]);
      }
      return {
        allowed: (result.meta?.changes ?? 0) > 0,
        retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1000)),
      };
    }
  } catch (error) {
    console.warn("[scaling] D1 rate counter unavailable; applying isolate-local protection", { namespace, error });
  }
  return localCounters.consume(`${namespace}:${identity}`, limit, windowMs, now);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestIdentity(request: Request) {
  const stampedIdentity = request.headers.get(TRUSTED_CLIENT_KEY_HEADER);
  if (stampedIdentity) return stampedIdentity;
  const cloudflareRequest = request as Request & { cf?: unknown };
  const cloudflareIp = cloudflareRequest.cf ? request.headers.get("cf-connecting-ip") : null;
  if (cloudflareIp) return sha256(`aplexanalysis-edge-ip:${cloudflareIp}`);
  return "local-development";
}

export async function stampTrustedClientIdentity(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete(TRUSTED_CLIENT_KEY_HEADER);
  const cloudflareRequest = request as Request & { cf?: unknown };
  const cloudflareIp = cloudflareRequest.cf ? request.headers.get("cf-connecting-ip") : null;
  const identity = cloudflareIp
    ? await sha256(`aplexanalysis-edge-ip:${cloudflareIp}`)
    : "local-development";
  headers.set(TRUSTED_CLIENT_KEY_HEADER, identity);
  return new Request(request, { headers });
}

export async function enforceRequestLimit(request: Request, kind: RequestLimitKind) {
  const identity = await requestIdentity(request);
  const profile = REQUEST_LIMITS[kind];
  const result = await consumeFixedWindow(`request:${kind}`, identity, profile.limit, profile.windowMs);
  if (!result.allowed) throw new RequestRateLimitError(kind, result.retryAfterSeconds);
}

// Paid requests fail closed if shared accounting is unavailable. No chat text is stored.
export async function enforceResearchLimit(request: Request) {
  const db = await getCacheDatabase();
  if (!db) throw new Error("AI Research requires shared request limits. Storage is unavailable.");
  const identity = await requestIdentity(request);
  const now = Date.now();
  for (const [key, limit, windowMs] of [[identity, 5, 60000], ["global", 100, 86400000]] as const) {
    const expires = Math.floor(now / windowMs) * windowMs + windowMs;
    const result = await db.prepare(`INSERT INTO request_rate_limits (counter_key, request_count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(counter_key) DO UPDATE SET request_count=request_rate_limits.request_count + 1
      WHERE request_rate_limits.request_count < ?`).bind(bucketKey("ai-research", key, windowMs, now), new Date(expires).toISOString(), limit).run();
    if ((result.meta?.changes ?? 0) < 1) throw new RequestRateLimitError("general", Math.ceil((expires - now) / 1000));
  }
}

async function readBuildResult<T>(buildKey: string): Promise<T | null> {
  try {
    const db = await getCacheDatabase();
    if (!db) return null;
    const row = await db.prepare(`
      SELECT payload_json FROM scaling_build_results WHERE build_key=? AND expires_at > ?
    `).bind(buildKey, new Date().toISOString()).first<{ payload_json: string }>();
    return row ? JSON.parse(row.payload_json) as T : null;
  } catch (error) {
    console.warn("[scaling] shared build result unavailable", { buildKey, error });
    return null;
  }
}

async function writeBuildResult<T>(buildKey: string, value: T) {
  const db = await getCacheDatabase();
  if (!db) return;
  const completedAt = new Date();
  await db.prepare(`
    INSERT INTO scaling_build_results (build_key, payload_json, completed_at, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(build_key) DO UPDATE SET payload_json=excluded.payload_json,
      completed_at=excluded.completed_at, expires_at=excluded.expires_at
  `).bind(
    buildKey,
    JSON.stringify(value),
    completedAt.toISOString(),
    new Date(completedAt.getTime() + BUILD_RESULT_TTL_MS).toISOString(),
  ).run();
}

export async function coordinateAnalysisBuild<T>(buildKey: string, build: () => Promise<T>) {
  const versionedKey = `analysis-build:v1:${buildKey}`;
  const leaseKey = `cold:${versionedKey}`;
  return coordinateColdBuild({
    key: versionedKey,
    build,
    readResult: () => readBuildResult<T>(versionedKey),
    writeResult: (value) => writeBuildResult(versionedKey, value),
    acquireLease: () => acquireCacheRefreshLease(leaseKey, BUILD_LEASE_MS),
    releaseLease: () => releaseCacheRefreshLease(leaseKey),
  });
}

async function acquireSecPermit() {
  const now = Date.now();
  const deadline = now + SEC_BUDGET_WAIT_MS;
  let permitAt: number;
  try {
    const db = await getCacheDatabase();
    if (db) {
      const row = await db.prepare(`
        INSERT INTO provider_request_budgets (provider_key, next_available_at) VALUES (?, ?)
        ON CONFLICT(provider_key) DO UPDATE SET next_available_at =
          CASE WHEN provider_request_budgets.next_available_at < ? THEN ?
            ELSE provider_request_budgets.next_available_at + ? END
        WHERE provider_request_budgets.next_available_at <= ?
        RETURNING next_available_at
      `).bind(
        "sec",
        now + SEC_REQUEST_INTERVAL_MS,
        now,
        now + SEC_REQUEST_INTERVAL_MS,
        SEC_REQUEST_INTERVAL_MS,
        deadline,
      ).first<{ next_available_at: number }>();
      if (!row) throw new Error("SEC request queue is busy. Please retry shortly.");
      permitAt = row.next_available_at - SEC_REQUEST_INTERVAL_MS;
    } else {
      const reserved = reservePacedSlot(localSecNextAvailableAt, now, SEC_REQUEST_INTERVAL_MS);
      permitAt = reserved.permitAt;
      localSecNextAvailableAt = reserved.nextAvailableAt;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "SEC request queue is busy. Please retry shortly.") throw error;
    console.warn("[scaling] D1 SEC budget unavailable; applying isolate-local pacing", { error });
    const reserved = reservePacedSlot(localSecNextAvailableAt, now, SEC_REQUEST_INTERVAL_MS);
    permitAt = reserved.permitAt;
    localSecNextAvailableAt = reserved.nextAvailableAt;
  }
  if (permitAt > deadline) throw new Error("SEC request queue is busy. Please retry shortly.");
  const waitMs = permitAt - Date.now();
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}

export async function pruneScalingState(now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return;
  await db.batch([
    db.prepare(`DELETE FROM scaling_build_results WHERE expires_at <= ?`).bind(now.toISOString()),
    db.prepare(`DELETE FROM request_rate_limits WHERE expires_at <= ?`).bind(now.toISOString()),
  ]);
}

export async function fetchSecResource(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (!(url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov"))) {
    throw new Error("SEC fetch helper received a non-SEC URL.");
  }
  await acquireSecPermit();
  return fetch(input, init);
}
