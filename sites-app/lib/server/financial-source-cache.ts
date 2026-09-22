import type { FinancialFingerprint, FinancialSource } from "./analysis.ts";
import { byteLength, ensureIdentity, getCacheDatabase } from "./cache-database.ts";
import { CACHE_TTLS } from "./cache-policy.ts";
import { recordCacheEvent } from "./cache-telemetry.ts";
import { NORMALIZATION_VERSION } from "./model-versions.ts";

type FinancialRow = {
  company_id: string;
  listing_id: string;
  profile_json: string;
  annual_json: string;
  quarterly_json: string;
  filings_json: string;
  risks_json: string;
  normalization_version: string;
  source_fingerprint: string | null;
  source_filing_at: string | null;
  normalized_at: string;
  fresh_until: string;
};

export type CachedFinancialSource = {
  source: FinancialSource;
  companyId: string;
  listingId: string;
  normalizationVersion: string;
  sourceFingerprint: string | null;
  sourceFilingAt: string | null;
  normalizedAt: string;
  freshUntil: string;
  isFresh: boolean;
};

export function hasSameFinancialFingerprint(cached: Pick<CachedFinancialSource, "sourceFingerprint">, fingerprint: FinancialFingerprint) {
  return Boolean(cached.sourceFingerprint && cached.sourceFingerprint === fingerprint.accessionNumber);
}

export async function readFinancialSourceCache(ticker: string): Promise<CachedFinancialSource | null> {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return null;
  const normalizedTicker = ticker.trim().toUpperCase();
  const row = await db.prepare(`
    SELECT nf.company_id, l.id AS listing_id, nf.profile_json, nf.annual_json,
      nf.quarterly_json, nf.filings_json, nf.risks_json, nf.normalization_version,
      nf.source_fingerprint, nf.source_filing_at, nf.normalized_at, nf.fresh_until
    FROM normalized_financial_cache nf
    INNER JOIN listings l ON l.company_id = nf.company_id
    WHERE l.ticker = ? COLLATE NOCASE
    ORDER BY l.is_primary DESC LIMIT 1
  `).bind(normalizedTicker).first<FinancialRow>();
  if (!row || row.normalization_version !== NORMALIZATION_VERSION) {
    await recordCacheEvent(db, { listingId: row?.listing_id, ticker: normalizedTicker, component: "financials", outcome: row ? "version_miss" : "miss", durationMs: Date.now() - startedAt });
    return null;
  }
  try {
    const source: FinancialSource = {
      profile: JSON.parse(row.profile_json),
      periods: JSON.parse(row.annual_json),
      quarterlyPeriods: JSON.parse(row.quarterly_json),
      filings: JSON.parse(row.filings_json),
      filingRisks: JSON.parse(row.risks_json),
    };
    if (!source.profile?.cik || source.periods.length < 3) throw new Error("Cached normalized financials are incomplete");
    const isFresh = Date.parse(row.fresh_until) > Date.now();
    await recordCacheEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component: "financials", outcome: isFresh ? "hit" : "stale", durationMs: Date.now() - startedAt, jsonBytes: byteLength(row.annual_json) + byteLength(row.quarterly_json) });
    return {
      source,
      companyId: row.company_id,
      listingId: row.listing_id,
      normalizationVersion: row.normalization_version,
      sourceFingerprint: row.source_fingerprint,
      sourceFilingAt: row.source_filing_at,
      normalizedAt: row.normalized_at,
      freshUntil: row.fresh_until,
      isFresh,
    };
  } catch (error) {
    await recordCacheEvent(db, { listingId: row.listing_id, ticker: normalizedTicker, component: "financials", outcome: "corrupt", error: error instanceof Error ? error.message : "Invalid financial cache" });
    return null;
  }
}

function fingerprintFromSource(source: FinancialSource): FinancialFingerprint {
  const filing = source.filings.find((item) => ["10-K", "10-Q", "20-F", "40-F"].includes(item.form));
  return { accessionNumber: filing?.accession_number ?? "none", filingDate: filing?.filing_date ?? null, form: filing?.form ?? null };
}

export async function writeFinancialSourceCache(ticker: string, source: FinancialSource, now = new Date()) {
  const startedAt = Date.now();
  const db = await getCacheDatabase();
  if (!db) return null;
  const timestamp = now.toISOString();
  const identity = await ensureIdentity(db, ticker, source.profile, timestamp);
  const fingerprint = fingerprintFromSource(source);
  const annualJson = JSON.stringify(source.periods);
  const quarterlyJson = JSON.stringify(source.quarterlyPeriods);
  const filingsJson = JSON.stringify(source.filings);
  const risksJson = JSON.stringify(source.filingRisks);
  const profileJson = JSON.stringify(source.profile);
  const latestJson = JSON.stringify(source.periods.at(-1)?.values ?? {});
  const provenanceJson = JSON.stringify({
    annual: source.periods.at(-1)?.provenance ?? {},
    quarterly: source.quarterlyPeriods.at(-1)?.provenance ?? {},
  });
  const freshUntil = new Date(now.getTime() + CACHE_TTLS.financial_check).toISOString();
  const jsonBytes = [profileJson, annualJson, quarterlyJson, filingsJson, risksJson, latestJson, provenanceJson]
    .reduce((sum, value) => sum + byteLength(value), 0);
  await db.prepare(`
    INSERT INTO normalized_financial_cache (
      company_id, profile_json, annual_json, quarterly_json, filings_json, risks_json,
      latest_json, provenance_json, normalization_version, source_fingerprint,
      source_filing_at, normalized_at, fresh_until, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET profile_json=excluded.profile_json,
      annual_json=excluded.annual_json, quarterly_json=excluded.quarterly_json,
      filings_json=excluded.filings_json, risks_json=excluded.risks_json,
      latest_json=excluded.latest_json, provenance_json=excluded.provenance_json,
      normalization_version=excluded.normalization_version,
      source_fingerprint=excluded.source_fingerprint, source_filing_at=excluded.source_filing_at,
      normalized_at=excluded.normalized_at, fresh_until=excluded.fresh_until,
      updated_at=excluded.updated_at
  `).bind(
    identity.companyId, profileJson, annualJson, quarterlyJson, filingsJson, risksJson,
    latestJson, provenanceJson, NORMALIZATION_VERSION, fingerprint.accessionNumber,
    fingerprint.filingDate, timestamp, freshUntil, timestamp,
  ).run();
  await recordCacheEvent(db, { listingId: identity.listingId, ticker: identity.ticker, component: "financials", outcome: "refresh_success", durationMs: Date.now() - startedAt, jsonBytes, provider: "SEC EDGAR" });
  return { ...identity, fingerprint, normalizedAt: timestamp, freshUntil };
}

export async function extendFinancialFreshness(ticker: string, cached: CachedFinancialSource, fingerprint: FinancialFingerprint, now = new Date()) {
  const db = await getCacheDatabase();
  if (!db) return cached;
  const freshUntil = new Date(now.getTime() + CACHE_TTLS.financial_check).toISOString();
  await db.prepare(`
    UPDATE normalized_financial_cache SET source_fingerprint=?, source_filing_at=?,
      fresh_until=?, updated_at=? WHERE company_id=?
  `).bind(fingerprint.accessionNumber, fingerprint.filingDate, freshUntil, now.toISOString(), cached.companyId).run();
  await recordCacheEvent(db, { listingId: cached.listingId, ticker: ticker.trim().toUpperCase(), component: "financials", outcome: "filing_unchanged" });
  return { ...cached, sourceFingerprint: fingerprint.accessionNumber, sourceFilingAt: fingerprint.filingDate, freshUntil, isFresh: true };
}
