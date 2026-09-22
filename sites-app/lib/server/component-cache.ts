import type { AnalystEstimates, FinancialSource, PeerSet, Quote } from "./analysis.ts";
import { byteLength, ensureIdentity, getCacheDatabase } from "./cache-database.ts";
import { recordCacheEvent } from "./cache-telemetry.ts";

export type ComponentName = "quote" | "analyst_estimates" | "comps" | "risks" | "news";
export type CachedComponent<T> = {
  data: T;
  listingId: string;
  provider: string | null;
  fetchedAt: string;
  freshUntil: string;
  lastSuccessfulRefresh: string;
  isFresh: boolean;
};

export type ComponentCacheRow = {
  listing_id: string;
  payload_json: string;
  provider: string | null;
  source_version: string;
  fetched_at: string;
  fresh_until: string;
  last_successful_refresh: string;
  json_bytes: number;
};

export function parseCachedComponentRow<T>(row: ComponentCacheRow, now = Date.now()): CachedComponent<T> {
  return {
    data: JSON.parse(row.payload_json) as T,
    listingId: row.listing_id,
    provider: row.provider,
    fetchedAt: row.fetched_at,
    freshUntil: row.fresh_until,
    lastSuccessfulRefresh: row.last_successful_refresh,
    isFresh: Date.parse(row.fresh_until) > now,
  };
}

export async function readComponentCache<T>(ticker: string, component: ComponentName, sourceVersion: string): Promise<CachedComponent<T> | null> {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return null;
  const normalizedTicker = ticker.trim().toUpperCase();
  const row = await db.prepare(`
    SELECT cc.listing_id, cc.payload_json, cc.provider, cc.source_version,
      cc.fetched_at, cc.fresh_until, cc.last_successful_refresh, cc.json_bytes
    FROM component_cache cc INNER JOIN listings l ON l.id=cc.listing_id
    WHERE l.ticker=? COLLATE NOCASE AND cc.component=?
    ORDER BY l.is_primary DESC LIMIT 1
  `).bind(normalizedTicker, component).first<ComponentCacheRow>();
  if (!row || row.source_version !== sourceVersion) {
    await recordCacheEvent(db, { listingId: row?.listing_id, ticker: normalizedTicker, component, outcome: row ? "version_miss" : "miss", durationMs: Date.now() - startedAt });
    return null;
  }
  try {
    const cached = parseCachedComponentRow<T>(row);
    await recordCacheEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component, outcome: cached.isFresh ? "hit" : "stale", durationMs: Date.now() - startedAt, jsonBytes: row.json_bytes, provider: row.provider });
    return cached;
  } catch (error) {
    await recordCacheEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component, outcome: "corrupt", error: error instanceof Error ? error.message : "Invalid component cache" });
    return null;
  }
}

export async function writeComponentCache<T>(
  ticker: string,
  profile: FinancialSource["profile"],
  component: ComponentName,
  data: T,
  sourceVersion: string,
  ttlMs: number,
  provider: string | null,
  refreshStartedAt = Date.now(),
  now = new Date(),
) {
  const db = await getCacheDatabase();
  if (!db) return null;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, ticker, profile, timestamp);
  const payloadJson = JSON.stringify(data);
  const freshUntil = new Date(now.getTime() + ttlMs).toISOString();
  const jsonBytes = byteLength(payloadJson);
  await db.prepare(`
    INSERT INTO component_cache (
      listing_id, component, payload_json, provider, source_version, fetched_at,
      fresh_until, last_successful_refresh, last_refresh_error, json_bytes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(listing_id, component) DO UPDATE SET payload_json=excluded.payload_json,
      provider=excluded.provider, source_version=excluded.source_version,
      fetched_at=excluded.fetched_at, fresh_until=excluded.fresh_until,
      last_successful_refresh=excluded.last_successful_refresh,
      last_refresh_error=NULL, json_bytes=excluded.json_bytes, updated_at=excluded.updated_at
  `).bind(identity.listingId, component, payloadJson, provider, sourceVersion, timestamp, freshUntil, timestamp, jsonBytes, timestamp).run();
  await recordCacheEvent(db, { listingId: identity.listingId, ticker: identity.ticker, component, outcome: "refresh_success", durationMs: Date.now() - refreshStartedAt, jsonBytes, provider });
  return { ...identity, fetchedAt: timestamp, freshUntil, jsonBytes };
}

export type CachedQuote = CachedComponent<Quote>;
export type CachedEstimates = CachedComponent<AnalystEstimates>;
export type CachedPeers = CachedComponent<PeerSet>;
