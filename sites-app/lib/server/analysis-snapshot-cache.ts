import type { Analysis } from "@/lib/types";
import { byteLength, ensureIdentity, getCacheDatabase } from "./cache-database.ts";
import { CACHE_TTLS } from "./cache-policy.ts";
import { recordCacheEvent } from "./cache-telemetry.ts";
import {
  readHotAnalysisCache,
  writeHotAnalysisCache,
  type CachedAnalysis,
} from "./hot-analysis-cache.ts";
import {
  ANALYSIS_SCHEMA_VERSION,
  COMPONENT_SOURCE_VERSIONS,
  NORMALIZATION_VERSION,
  SCORE_MODEL_VERSION,
  VALUATION_MODEL_VERSION,
} from "./model-versions.ts";

export type CacheRow = {
  listing_id: string;
  payload_json: string;
  schema_version?: number;
  normalization_version?: string;
  valuation_model_version?: string;
  score_model_version?: string;
  component_source_versions_json?: string;
  generated_at: string;
  fresh_until: string;
  json_bytes?: number;
};

export function parseCachedAnalysisRow(row: CacheRow, now = Date.now()): CachedAnalysis | null {
  try {
    const analysis = JSON.parse(row.payload_json) as Analysis;
    if (!analysis?.company?.ticker || !Array.isArray(analysis.financials)) return null;
    return {
      analysis,
      listingId: row.listing_id,
      generatedAt: row.generated_at,
      freshUntil: row.fresh_until,
      isFresh: Date.parse(row.fresh_until) > now,
    };
  } catch {
    return null;
  }
}

export function isAnalysisCacheCompatible(row: Pick<CacheRow, "schema_version" | "normalization_version" | "valuation_model_version" | "score_model_version" | "component_source_versions_json">) {
  let componentVersions: Record<string, unknown> = {};
  try {
    componentVersions = JSON.parse(row.component_source_versions_json ?? "{}");
  } catch {
    return false;
  }
  return row.schema_version === ANALYSIS_SCHEMA_VERSION
    && row.normalization_version === NORMALIZATION_VERSION
    && row.valuation_model_version === VALUATION_MODEL_VERSION
    && row.score_model_version === SCORE_MODEL_VERSION
    && Object.entries(COMPONENT_SOURCE_VERSIONS).every(([component, version]) => componentVersions[component] === version);
}

export async function readCachedAnalysis(ticker: string): Promise<CachedAnalysis | null> {
  const startedAt = Date.now();
  const normalizedTicker = ticker.trim().toUpperCase();
  const hot = readHotAnalysisCache(normalizedTicker, startedAt);
  if (hot) return hot;
  const db = await getCacheDatabase();
  if (!db) return null;
  const row = await db.prepare(`
    SELECT ac.listing_id, ac.payload_json, ac.schema_version, ac.normalization_version,
      ac.valuation_model_version, ac.score_model_version, ac.component_source_versions_json, ac.generated_at,
      ac.fresh_until, ac.json_bytes
    FROM analysis_cache ac INNER JOIN listings l ON l.id = ac.listing_id
    WHERE l.ticker = ? COLLATE NOCASE
    ORDER BY l.is_primary DESC, ac.updated_at DESC LIMIT 1
  `).bind(normalizedTicker).first<CacheRow>();
  if (!row) {
    await recordCacheEvent(db, { ticker: normalizedTicker, component: "analysis", outcome: "miss", durationMs: Date.now() - startedAt });
    return null;
  }
  if (!isAnalysisCacheCompatible(row)) {
    await recordCacheEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component: "analysis", outcome: "version_miss", durationMs: Date.now() - startedAt });
    return null;
  }
  const cached = parseCachedAnalysisRow(row);
  if (cached) writeHotAnalysisCache(normalizedTicker, cached);
  await recordCacheEvent(db, {
    listingId: row.listing_id,
    ticker: normalizedTicker,
    component: "analysis",
    outcome: cached?.isFresh ? "hit" : "stale",
    durationMs: Date.now() - startedAt,
    jsonBytes: row.json_bytes ?? byteLength(row.payload_json),
  });
  return cached;
}

export async function writeAnalysisSnapshot(analysis: Analysis, now = new Date()) {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return false;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, analysis.company.ticker, analysis.company, timestamp);
  const payloadJson = JSON.stringify(analysis);
  const generatedAt = analysis.provenance.generated_at || timestamp;
  const freshUntil = new Date(now.getTime() + CACHE_TTLS.analysis).toISOString();
  const jsonBytes = byteLength(payloadJson);
  await db.prepare(`
    INSERT INTO analysis_cache (
      listing_id, payload_json, schema_version, normalization_version,
      valuation_model_version, score_model_version, component_source_versions_json, generated_at, fresh_until,
      refresh_started_at, last_refresh_error, last_successful_refresh, json_bytes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    ON CONFLICT(listing_id) DO UPDATE SET payload_json=excluded.payload_json,
      schema_version=excluded.schema_version, normalization_version=excluded.normalization_version,
      valuation_model_version=excluded.valuation_model_version, score_model_version=excluded.score_model_version,
      component_source_versions_json=excluded.component_source_versions_json,
      generated_at=excluded.generated_at, fresh_until=excluded.fresh_until,
      refresh_started_at=NULL, last_refresh_error=NULL,
      last_successful_refresh=excluded.last_successful_refresh,
      json_bytes=excluded.json_bytes, updated_at=excluded.updated_at
  `).bind(
    identity.listingId, payloadJson, ANALYSIS_SCHEMA_VERSION, NORMALIZATION_VERSION,
    VALUATION_MODEL_VERSION, SCORE_MODEL_VERSION, JSON.stringify(COMPONENT_SOURCE_VERSIONS), generatedAt, freshUntil,
    timestamp, jsonBytes, timestamp,
  ).run();
  writeHotAnalysisCache(identity.ticker, {
    analysis,
    listingId: identity.listingId,
    generatedAt,
    freshUntil,
    isFresh: true,
  }, now.getTime());
  await recordCacheEvent(db, { listingId: identity.listingId, ticker: identity.ticker, component: "analysis", outcome: "refresh_success", durationMs: Date.now() - startedAt, jsonBytes });
  return identity;
}

export const writeCachedAnalysis = writeAnalysisSnapshot;

export type { CachedAnalysis } from "./hot-analysis-cache.ts";
