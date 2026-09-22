import assert from "node:assert/strict";
import test from "node:test";

import {
  isAnalysisCacheCompatible,
  parseCachedAnalysisRow,
} from "../lib/server/analysis-snapshot-cache.ts";
import type { D1Database, D1PreparedStatement } from "../lib/server/cache-database.ts";
import {
  acquireAnalysisRefreshLeaseWithDatabase,
  acquireCacheRefreshLeaseWithDatabase,
} from "../lib/server/cache-refresh.ts";
import { parseCachedComponentRow } from "../lib/server/component-cache.ts";
import {
  readHotAnalysisCache,
  writeHotAnalysisCache,
  type CachedAnalysis,
} from "../lib/server/hot-analysis-cache.ts";
import {
  ANALYSIS_SCHEMA_VERSION,
  COMPONENT_SOURCE_VERSIONS,
  NORMALIZATION_VERSION,
  SCORE_MODEL_VERSION,
  VALUATION_MODEL_VERSION,
} from "../lib/server/model-versions.ts";

function analysisPayload(ticker: string) {
  return {
    company: { ticker },
    financials: [],
    provenance: { generated_at: "2026-08-31T00:00:00.000Z" },
  };
}

function cachedAnalysis(ticker: string, freshUntil = "2026-09-01T00:00:00.000Z"): CachedAnalysis {
  return {
    analysis: analysisPayload(ticker) as unknown as CachedAnalysis["analysis"],
    listingId: `listing:test:${ticker.toLowerCase()}`,
    generatedAt: "2026-08-31T00:00:00.000Z",
    freshUntil,
    isFresh: true,
  };
}

function createLeaseDatabase(): D1Database {
  const cacheLeases = new Map<string, string>();
  const analysisLeases = new Map<string, string>();

  return {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind(...boundValues: unknown[]) {
          values = boundValues;
          return statement;
        },
        async first<T>() {
          return null as T | null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          if (query.includes("INSERT INTO cache_refresh_leases")) {
            const [cacheKey, acquiredAt, expiresAt] = values as [string, string, string];
            const currentExpiry = cacheLeases.get(cacheKey);
            if (!currentExpiry || currentExpiry < acquiredAt) {
              cacheLeases.set(cacheKey, expiresAt);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (query.includes("UPDATE analysis_cache SET refresh_started_at")) {
            const [refreshStartedAt, , listingId, leaseExpiredBefore] = values as [string, string, string, string];
            const currentStart = analysisLeases.get(listingId);
            if (!currentStart || currentStart < leaseExpiredBefore) {
              analysisLeases.set(listingId, refreshStartedAt);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
  };
}

test("analysis cache compatibility requires every current model and component version", () => {
  const compatible = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    valuation_model_version: VALUATION_MODEL_VERSION,
    score_model_version: SCORE_MODEL_VERSION,
    component_source_versions_json: JSON.stringify(COMPONENT_SOURCE_VERSIONS),
  };

  assert.equal(isAnalysisCacheCompatible(compatible), true);
  assert.equal(isAnalysisCacheCompatible({ ...compatible, schema_version: ANALYSIS_SCHEMA_VERSION - 1 }), false);
  assert.equal(isAnalysisCacheCompatible({ ...compatible, component_source_versions_json: "not-json" }), false);
  assert.equal(isAnalysisCacheCompatible({
    ...compatible,
    component_source_versions_json: JSON.stringify({ ...COMPONENT_SOURCE_VERSIONS, news: "old-news" }),
  }), false);
});

test("analysis and component rows switch from fresh to stale at the exact expiry boundary", () => {
  const expiry = Date.parse("2026-08-31T12:00:00.000Z");
  const analysisRow = {
    listing_id: "listing:test:aapl",
    payload_json: JSON.stringify(analysisPayload("AAPL")),
    generated_at: "2026-08-31T11:55:00.000Z",
    fresh_until: new Date(expiry).toISOString(),
  };
  assert.equal(parseCachedAnalysisRow(analysisRow, expiry - 1)?.isFresh, true);
  assert.equal(parseCachedAnalysisRow(analysisRow, expiry)?.isFresh, false);
  assert.equal(parseCachedAnalysisRow({ ...analysisRow, payload_json: "{" }, expiry), null);

  const componentRow = {
    listing_id: "listing:test:aapl",
    payload_json: JSON.stringify({ price: 123 }),
    provider: "test",
    source_version: "quote-test",
    fetched_at: "2026-08-31T11:50:00.000Z",
    fresh_until: new Date(expiry).toISOString(),
    last_successful_refresh: "2026-08-31T11:50:00.000Z",
    json_bytes: 13,
  };
  assert.equal(parseCachedComponentRow(componentRow, expiry - 1)?.isFresh, true);
  assert.equal(parseCachedComponentRow(componentRow, expiry)?.isFresh, false);
  assert.throws(() => parseCachedComponentRow({ ...componentRow, payload_json: "{" }, expiry));
});

test("hot analysis cache expires entries and evicts the least recently used entry at its bound", () => {
  const now = 1_000;
  writeHotAnalysisCache("P7-EXPIRY", cachedAnalysis("P7-EXPIRY"), now);
  assert.ok(readHotAnalysisCache("p7-expiry", now + 29_999));
  assert.equal(readHotAnalysisCache("P7-EXPIRY", now + 30_000), null);

  for (let index = 0; index < 64; index += 1) {
    writeHotAnalysisCache(`P7-${index}`, cachedAnalysis(`P7-${index}`), now);
  }
  assert.ok(readHotAnalysisCache("P7-0", now + 1));
  writeHotAnalysisCache("P7-64", cachedAnalysis("P7-64"), now + 1);
  assert.ok(readHotAnalysisCache("P7-0", now + 2));
  assert.equal(readHotAnalysisCache("P7-1", now + 2), null);
  assert.ok(readHotAnalysisCache("P7-64", now + 2));
});

test("refresh leases reject overlap and become acquirable only after expiry", async () => {
  const db = createLeaseDatabase();
  const start = new Date("2026-08-31T12:00:00.000Z");

  assert.equal(await acquireCacheRefreshLeaseWithDatabase(db, "overview:AAPL", 60_000, start), true);
  assert.equal(await acquireCacheRefreshLeaseWithDatabase(db, "overview:AAPL", 60_000, new Date(start.getTime() + 30_000)), false);
  assert.equal(await acquireCacheRefreshLeaseWithDatabase(db, "overview:AAPL", 60_000, new Date(start.getTime() + 60_000)), false);
  assert.equal(await acquireCacheRefreshLeaseWithDatabase(db, "overview:AAPL", 60_000, new Date(start.getTime() + 60_001)), true);

  assert.equal(await acquireAnalysisRefreshLeaseWithDatabase(db, "listing:test:aapl", start), true);
  assert.equal(await acquireAnalysisRefreshLeaseWithDatabase(db, "listing:test:aapl", new Date(start.getTime() + 60_000)), false);
  assert.equal(await acquireAnalysisRefreshLeaseWithDatabase(db, "listing:test:aapl", new Date(start.getTime() + 120_000)), false);
  assert.equal(await acquireAnalysisRefreshLeaseWithDatabase(db, "listing:test:aapl", new Date(start.getTime() + 120_001)), true);
});
