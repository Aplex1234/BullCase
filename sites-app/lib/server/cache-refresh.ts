import {
  getCacheDatabase,
  scheduleBackgroundTask,
  type D1Database,
} from "./cache-database.ts";
import {
  claimThrottledWork,
  takeAggregatedViewDelta,
  type AggregatedViewState,
} from "./cache-efficiency.ts";
import { CACHE_TTLS, REFRESH_LEASE_MS } from "./cache-policy.ts";
import { recordCacheEvent } from "./cache-telemetry.ts";

export async function acquireAnalysisRefreshLeaseWithDatabase(db: D1Database, listingId: string, now = new Date()) {
  const leaseExpiredBefore = new Date(now.getTime() - REFRESH_LEASE_MS).toISOString();
  const result = await db.prepare(`
    UPDATE analysis_cache SET refresh_started_at=?, updated_at=? WHERE listing_id=?
      AND (refresh_started_at IS NULL OR refresh_started_at < ?)
  `).bind(now.toISOString(), now.toISOString(), listingId, leaseExpiredBefore).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function acquireRefreshLease(listingId: string, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return false;
  return acquireAnalysisRefreshLeaseWithDatabase(db, listingId, now);
}

export async function acquireCacheRefreshLeaseWithDatabase(
  db: D1Database,
  cacheKey: string,
  leaseMs = REFRESH_LEASE_MS,
  now = new Date(),
) {
  const timestamp = now.toISOString();
  const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const result = await db.prepare(`
    INSERT INTO cache_refresh_leases (cache_key, acquired_at, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET acquired_at=excluded.acquired_at, expires_at=excluded.expires_at
    WHERE cache_refresh_leases.expires_at < excluded.acquired_at
  `).bind(cacheKey, timestamp, expiresAt).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function acquireCacheRefreshLease(cacheKey: string, leaseMs = REFRESH_LEASE_MS, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return true;
  return acquireCacheRefreshLeaseWithDatabase(db, cacheKey, leaseMs, now);
}

export async function releaseCacheRefreshLease(cacheKey: string) {
  const db = await getCacheDatabase();
  if (!db) return;
  await db.prepare(`DELETE FROM cache_refresh_leases WHERE cache_key=?`).bind(cacheKey).run();
}

export async function recordRefreshFailure(listingId: string, error: unknown) {
  const db = await getCacheDatabase();
  if (!db) return;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await db.prepare(`UPDATE analysis_cache SET refresh_started_at=NULL, last_refresh_error=?, updated_at=? WHERE listing_id=?`)
    .bind(message, new Date().toISOString(), listingId).run();
  await recordCacheEvent(db, { listingId, ticker: "UNKNOWN", component: "analysis", outcome: "refresh_failure", error: message });
}

export async function scheduleBackgroundRefresh(task: Promise<unknown>) {
  return scheduleBackgroundTask(task);
}

export async function recordCompanyView(ticker: string, listingId: string, now = new Date(), increment = 1) {
  const db = await getCacheDatabase();
  if (!db) return;
  const timestamp = now.toISOString();
  const nextRefreshAt = new Date(now.getTime() + CACHE_TTLS.popular_refresh).toISOString();
  await db.prepare(`
    INSERT INTO cache_refresh_schedule (listing_id, ticker, view_count, priority, last_viewed_at, next_refresh_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(listing_id) DO UPDATE SET view_count=view_count+excluded.view_count,
      ticker=excluded.ticker, last_viewed_at=excluded.last_viewed_at,
      next_refresh_at=CASE WHEN next_refresh_at < excluded.next_refresh_at THEN next_refresh_at ELSE excluded.next_refresh_at END,
      updated_at=excluded.updated_at
  `).bind(listingId, ticker.toUpperCase(), Math.max(1, Math.trunc(increment)), timestamp, nextRefreshAt, timestamp).run();
}

const pendingCompanyViews: AggregatedViewState = new Map();
const dueRefreshCheckClaims = new Map<string, number>();

export async function recordCompanyViewInBackground(ticker: string, listingId: string, now = new Date()) {
  const increment = takeAggregatedViewDelta(pendingCompanyViews, listingId, now.getTime());
  if (increment === 0) return false;
  const task = recordCompanyView(ticker, listingId, now, increment).catch(() => undefined);
  if (!await scheduleBackgroundRefresh(task)) await task;
  return true;
}

export function shouldCheckForDueRefresh(now = Date.now()) {
  return claimThrottledWork(dueRefreshCheckClaims, "popular-refresh", now);
}

export async function listDueRefreshTickers(limit = 5, excludeTicker?: string) {
  const db = await getCacheDatabase();
  if (!db) return [];
  const rows = await db.prepare(`
    SELECT listing_id, ticker FROM cache_refresh_schedule
    WHERE next_refresh_at <= ? AND view_count >= 2 AND ticker <> ?
    ORDER BY priority DESC, view_count DESC, last_viewed_at DESC LIMIT ?
  `).bind(new Date().toISOString(), (excludeTicker ?? "").toUpperCase(), limit).all<{ listing_id: string; ticker: string }>();
  return rows.results ?? [];
}

export async function listUncachedTickers(candidates: string[], limit = 2) {
  const normalized = [...new Set(candidates.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) return [];
  const db = await getCacheDatabase();
  if (!db) return normalized.slice(0, limit);
  const placeholders = normalized.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT ticker FROM listings WHERE ticker COLLATE NOCASE IN (${placeholders})`)
    .bind(...normalized).all<{ ticker: string }>();
  const cached = new Set((rows.results ?? []).map((row) => row.ticker.toUpperCase()));
  return normalized.filter((ticker) => !cached.has(ticker)).slice(0, Math.max(0, limit));
}

export async function markScheduledRefresh(listingId: string, success: boolean, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return;
  const next = new Date(now.getTime() + (success ? CACHE_TTLS.popular_refresh : 5 * 60 * 1000)).toISOString();
  await db.prepare(`
    UPDATE cache_refresh_schedule SET last_scheduled_refresh=?, next_refresh_at=?, updated_at=? WHERE listing_id=?
  `).bind(now.toISOString(), next, now.toISOString(), listingId).run();
}
