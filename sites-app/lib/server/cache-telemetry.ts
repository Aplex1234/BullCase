import type { FinancialSource, PeerSet } from "./analysis.ts";
import {
  byteLength,
  ensureIdentity,
  getCacheDatabase,
  scheduleBackgroundTask,
  type D1Database,
} from "./cache-database.ts";
import { cacheEventSampleWeight } from "./cache-efficiency.ts";

export type CacheEvent = {
  listingId?: string | null;
  ticker: string;
  component: string;
  outcome: string;
  durationMs?: number | null;
  jsonBytes?: number | null;
  provider?: string | null;
  error?: string | null;
};

export async function recordCacheEvent(db: D1Database, event: CacheEvent) {
  const sampleWeight = cacheEventSampleWeight(event.outcome);
  if (sampleWeight === 0) return;
  const task = db.prepare(`
    INSERT INTO cache_events (listing_id, ticker, component, outcome, duration_ms, json_bytes, provider, error, sample_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    event.listingId ?? null,
    event.ticker,
    event.component,
    event.outcome,
    event.durationMs ?? null,
    event.jsonBytes ?? null,
    event.provider ?? null,
    event.error?.slice(0, 500) ?? null,
    sampleWeight,
  ).run();
  if (!await scheduleBackgroundTask(task)) await task;
}

export async function writePeerSelectionAudit(
  ticker: string,
  profile: FinancialSource["profile"],
  peerSet: PeerSet,
  now = new Date(),
) {
  const db = await getCacheDatabase();
  if (!db) return false;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, ticker, profile, timestamp);
  const runId = `peer-run:${identity.listingId}:${now.getTime()}:${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare(`
    INSERT INTO peer_selection_runs (
      id, target_listing_id, source_provider, source_url, source_as_of,
      selection_version, target_sector, target_industry, candidate_count,
      selected_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    runId,
    identity.listingId,
    peerSet.source_provider,
    peerSet.source_url,
    peerSet.source_as_of,
    peerSet.selection_version,
    profile.sector,
    profile.industry,
    peerSet.candidates_considered,
    peerSet.companies.length,
    timestamp,
  ).run();
  if (peerSet.companies.length) {
    await db.batch(peerSet.companies.map((company, index) => db.prepare(`
      INSERT INTO peer_selections (
        run_id, peer_ticker, peer_name, rank, score_basis_points, reason,
        factors_json, source_label, source_url, market_cap, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      runId,
      company.ticker,
      company.name,
      index + 1,
      Math.round(company.selection_score * 100),
      company.selection_reason,
      JSON.stringify(company.selection_factors),
      company.selection_source,
      company.selection_source_url,
      company.market_cap,
      timestamp,
    )));
  }
  const jsonBytes = byteLength(JSON.stringify(peerSet));
  await recordCacheEvent(db, {
    listingId: identity.listingId,
    ticker: identity.ticker,
    component: "comps_audit",
    outcome: "stored",
    jsonBytes,
    provider: peerSet.source_provider,
  });
  return true;
}

export async function recordProviderFailure(ticker: string, component: string, error: unknown, listingId?: string | null) {
  const db = await getCacheDatabase();
  if (!db) return;
  const message = error instanceof Error ? error.message : "Provider refresh failed";
  if (listingId && ["quote", "analyst_estimates", "comps", "risks"].includes(component)) {
    await db.prepare(`UPDATE component_cache SET last_refresh_error=?, updated_at=? WHERE listing_id=? AND component=?`)
      .bind(message.slice(0, 500), new Date().toISOString(), listingId, component).run();
  }
  await recordCacheEvent(db, { listingId, ticker: ticker.toUpperCase(), component, outcome: "provider_failure", error: message });
}

export async function pruneCacheEvents(retentionDays = 30, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return;
  const cutoff = new Date(now.getTime() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`DELETE FROM cache_events WHERE created_at < ?`).bind(cutoff).run();
}

export async function getCacheMonitoringSummary() {
  const db = await getCacheDatabase();
  if (!db) return { available: false, events: [], cachedCompanies: 0, lastSuccessfulRefresh: null };
  const events = await db.prepare(`
    SELECT component, outcome, SUM(sample_weight) AS count,
      ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
      MAX(json_bytes) AS max_json_bytes, MAX(created_at) AS last_event_at
    FROM cache_events
    WHERE created_at >= datetime('now', '-24 hours') GROUP BY component, outcome
    ORDER BY component, outcome
  `).all<{ component: string; outcome: string; count: number; avg_duration_ms: number | null; max_json_bytes: number | null; last_event_at: string }>();
  const cachedCompanies = await db.prepare(`SELECT COUNT(*) AS count FROM normalized_financial_cache`).first<{ count: number }>();
  const lastRefresh = await db.prepare(`
    SELECT MAX(value) AS value FROM (
      SELECT last_successful_refresh AS value FROM analysis_cache
      UNION ALL SELECT last_successful_refresh AS value FROM component_cache
      UNION ALL SELECT normalized_at AS value FROM normalized_financial_cache
    )
  `).first<{ value: string | null }>();
  return { available: true, events: events.results ?? [], cachedCompanies: cachedCompanies?.count ?? 0, lastSuccessfulRefresh: lastRefresh?.value ?? null };
}
