import type { Analysis } from "@/lib/types";
import type { FinancialSource } from "./analysis.ts";

export type D1Result = { success?: boolean; meta?: { changes?: number } };
export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<D1Result>;
};
export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
};

let schemaReady = false;

const CACHE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY NOT NULL, cik TEXT NOT NULL, name TEXT NOT NULL,
    sector TEXT, industry TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_cik ON companies (cik)`,
  `CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL, exchange TEXT, is_primary INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_exchange_ticker ON listings (exchange, ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_ticker ON listings (ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_company_id ON listings (company_id)`,
  `CREATE TABLE IF NOT EXISTS normalized_financial_cache (
    company_id TEXT PRIMARY KEY NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    profile_json TEXT DEFAULT '{}' NOT NULL, annual_json TEXT NOT NULL,
    quarterly_json TEXT NOT NULL, filings_json TEXT NOT NULL, risks_json TEXT DEFAULT '[]' NOT NULL,
    latest_json TEXT NOT NULL, provenance_json TEXT NOT NULL, normalization_version TEXT NOT NULL,
    source_fingerprint TEXT, source_filing_at TEXT, normalized_at TEXT NOT NULL,
    fresh_until TEXT DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS analysis_cache (
    listing_id TEXT PRIMARY KEY NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL, schema_version INTEGER DEFAULT 2 NOT NULL,
    normalization_version TEXT DEFAULT 'legacy' NOT NULL,
    valuation_model_version TEXT DEFAULT 'legacy' NOT NULL,
    score_model_version TEXT DEFAULT 'legacy' NOT NULL,
    component_source_versions_json TEXT DEFAULT '{}' NOT NULL,
    generated_at TEXT NOT NULL, fresh_until TEXT NOT NULL, refresh_started_at TEXT,
    last_refresh_error TEXT, last_successful_refresh TEXT, json_bytes INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_cache_fresh_until ON analysis_cache (fresh_until)`,
  `CREATE TABLE IF NOT EXISTS component_cache (
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    component TEXT NOT NULL, payload_json TEXT NOT NULL, provider TEXT,
    source_version TEXT NOT NULL, fetched_at TEXT NOT NULL, fresh_until TEXT NOT NULL,
    last_successful_refresh TEXT NOT NULL, last_refresh_error TEXT,
    json_bytes INTEGER DEFAULT 0 NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (listing_id, component)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_component_cache_component_fresh_until ON component_cache (component, fresh_until)`,
  `CREATE TABLE IF NOT EXISTS price_history_cache (
    ticker TEXT NOT NULL, range TEXT NOT NULL, payload_json TEXT NOT NULL,
    provider TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TEXT NOT NULL,
    fresh_until TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (ticker, range)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_price_history_cache_fresh_until ON price_history_cache (fresh_until)`,
  `CREATE TABLE IF NOT EXISTS reference_data_cache (
    cache_key TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL,
    provider TEXT NOT NULL, source_version TEXT NOT NULL, fetched_at TEXT NOT NULL,
    fresh_until TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reference_data_cache_fresh_until ON reference_data_cache (fresh_until)`,
  `CREATE TABLE IF NOT EXISTS cache_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT, ticker TEXT NOT NULL,
    component TEXT NOT NULL, outcome TEXT NOT NULL, duration_ms INTEGER,
    json_bytes INTEGER, provider TEXT, error TEXT, sample_weight INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cache_events_component_created_at ON cache_events (component, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_events_listing_created_at ON cache_events (listing_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS cache_refresh_schedule (
    listing_id TEXT PRIMARY KEY NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL, view_count INTEGER DEFAULT 1 NOT NULL, priority INTEGER DEFAULT 0 NOT NULL,
    last_viewed_at TEXT NOT NULL, next_refresh_at TEXT NOT NULL, last_scheduled_refresh TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cache_refresh_schedule_due ON cache_refresh_schedule (next_refresh_at, priority, view_count)`,
  `CREATE TABLE IF NOT EXISTS cache_refresh_leases (
    cache_key TEXT PRIMARY KEY NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cache_refresh_leases_expires_at ON cache_refresh_leases (expires_at)`,
  `CREATE TABLE IF NOT EXISTS scaling_build_results (
    build_key TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL,
    completed_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scaling_build_results_expires_at ON scaling_build_results (expires_at)`,
  `CREATE TABLE IF NOT EXISTS request_rate_limits (
    counter_key TEXT PRIMARY KEY NOT NULL, request_count INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_request_rate_limits_expires_at ON request_rate_limits (expires_at)`,
  `CREATE TABLE IF NOT EXISTS provider_request_budgets (
    provider_key TEXT PRIMARY KEY NOT NULL, next_available_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL,
    preferred_ai_provider TEXT DEFAULT 'openrouter' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles (email)`,
  `CREATE TABLE IF NOT EXISTS user_ai_credentials (
    user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    provider TEXT NOT NULL, model TEXT NOT NULL, key_ciphertext TEXT NOT NULL,
    key_iv TEXT NOT NULL, key_version INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, provider)
  )`,
  `CREATE TABLE IF NOT EXISTS favorite_stocks (
    user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    ticker TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, ticker)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_favorite_stocks_user_created_at ON favorite_stocks (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS peer_selection_runs (
    id TEXT PRIMARY KEY NOT NULL,
    target_listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    source_provider TEXT NOT NULL, source_url TEXT NOT NULL, source_as_of TEXT NOT NULL,
    selection_version TEXT NOT NULL, target_sector TEXT, target_industry TEXT,
    candidate_count INTEGER NOT NULL, selected_count INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_peer_selection_runs_target_created_at ON peer_selection_runs (target_listing_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS peer_selections (
    run_id TEXT NOT NULL REFERENCES peer_selection_runs(id) ON DELETE CASCADE,
    peer_ticker TEXT NOT NULL, peer_name TEXT NOT NULL, rank INTEGER NOT NULL,
    score_basis_points INTEGER NOT NULL, reason TEXT NOT NULL, factors_json TEXT NOT NULL,
    source_label TEXT NOT NULL, source_url TEXT NOT NULL, market_cap INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (run_id, peer_ticker)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_peer_selections_peer_ticker ON peer_selections (peer_ticker)`,
  `PRAGMA optimize`,
];

const LEGACY_COLUMNS: Array<[string, string, string]> = [
  ["normalized_financial_cache", "profile_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["normalized_financial_cache", "risks_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["normalized_financial_cache", "source_fingerprint", "TEXT"],
  ["normalized_financial_cache", "source_filing_at", "TEXT"],
  ["normalized_financial_cache", "fresh_until", "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'"],
  ["analysis_cache", "normalization_version", "TEXT NOT NULL DEFAULT 'legacy'"],
  ["analysis_cache", "valuation_model_version", "TEXT NOT NULL DEFAULT 'legacy'"],
  ["analysis_cache", "score_model_version", "TEXT NOT NULL DEFAULT 'legacy'"],
  ["analysis_cache", "component_source_versions_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["analysis_cache", "last_successful_refresh", "TEXT"],
  ["analysis_cache", "json_bytes", "INTEGER NOT NULL DEFAULT 0"],
  ["cache_events", "sample_weight", "INTEGER NOT NULL DEFAULT 1"],
];

async function workersRuntime() {
  try {
    return await import("cloudflare:workers") as unknown as {
      env?: { DB?: D1Database };
      waitUntil?: (promise: Promise<unknown>) => void;
    };
  } catch {
    return null;
  }
}

async function ensureLegacyColumns(db: D1Database) {
  for (const [table, column, definition] of LEGACY_COLUMNS) {
    const existing = await db.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`).bind(column).first();
    if (!existing) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export async function getCacheDatabase() {
  const db = (await workersRuntime())?.env?.DB ?? null;
  if (db && !schemaReady) {
    if (process.env.NODE_ENV !== "production") {
      await db.batch(CACHE_SCHEMA_SQL.map((statement) => db.prepare(statement)));
      await ensureLegacyColumns(db);
    }
    schemaReady = true;
  }
  return db;
}

export async function scheduleBackgroundTask(task: Promise<unknown>) {
  const waitUntil = (await workersRuntime())?.waitUntil;
  if (!waitUntil) return false;
  waitUntil(task);
  return true;
}

export function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function identifierToken(value: string | null | undefined) {
  return (value ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function listingMarket(exchange: string | null) {
  const micByExchange: Record<string, string> = {
    NASDAQ: "xnas", NYSE: "xnys", "NYSE AMERICAN": "xase", "NYSE ARCA": "arcx", CBOE: "bats", OTC: "otcm",
  };
  return micByExchange[(exchange ?? "").trim().toUpperCase()] ?? identifierToken(exchange);
}

export function cacheIdentity(company: Analysis["company"] | FinancialSource["profile"], ticker?: string) {
  const symbol = ticker ?? ("ticker" in company ? company.ticker : "unknown");
  const cik = company.cik.padStart(10, "0");
  return {
    cik,
    companyId: `sec-cik:${cik}`,
    listingId: `listing:${listingMarket(company.exchange)}:${identifierToken(symbol)}`,
    ticker: symbol.toUpperCase(),
  };
}

export async function ensureIdentity(
  db: D1Database,
  ticker: string,
  profile: FinancialSource["profile"] | Analysis["company"],
  now: string,
) {
  const identity = cacheIdentity(profile, ticker);
  await db.prepare(`
    INSERT INTO companies (id, cik, name, sector, industry, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET cik=excluded.cik, name=excluded.name,
      sector=excluded.sector, industry=excluded.industry, updated_at=excluded.updated_at
  `).bind(identity.companyId, identity.cik, profile.name, profile.sector, profile.industry, now, now).run();
  const existing = await db.prepare(`
    SELECT id FROM listings WHERE ticker=? COLLATE NOCASE
      AND (exchange=? COLLATE NOCASE OR exchange IS NULL OR ? IS NULL)
    ORDER BY is_primary DESC LIMIT 1
  `).bind(identity.ticker, profile.exchange, profile.exchange).first<{ id: string }>();
  const listingId = existing?.id ?? identity.listingId;
  await db.prepare(`
    INSERT INTO listings (id, company_id, ticker, exchange, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET company_id=excluded.company_id, ticker=excluded.ticker,
      exchange=excluded.exchange, is_primary=1, updated_at=excluded.updated_at
  `).bind(listingId, identity.companyId, identity.ticker, profile.exchange, now, now).run();
  return { ...identity, listingId };
}
