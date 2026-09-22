import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  cik: text("cik").notNull(),
  name: text("name").notNull(),
  sector: text("sector"),
  industry: text("industry"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_companies_cik").on(table.cik),
]);

export const listings = sqliteTable("listings", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  exchange: text("exchange"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_listings_exchange_ticker").on(table.exchange, table.ticker),
  index("idx_listings_ticker").on(table.ticker),
  index("idx_listings_company_id").on(table.companyId),
]);

export const normalizedFinancialCache = sqliteTable("normalized_financial_cache", {
  companyId: text("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  profileJson: text("profile_json").notNull().default("{}"),
  annualJson: text("annual_json").notNull(),
  quarterlyJson: text("quarterly_json").notNull(),
  filingsJson: text("filings_json").notNull(),
  risksJson: text("risks_json").notNull().default("[]"),
  latestJson: text("latest_json").notNull(),
  provenanceJson: text("provenance_json").notNull(),
  normalizationVersion: text("normalization_version").notNull(),
  sourceFingerprint: text("source_fingerprint"),
  sourceFilingAt: text("source_filing_at"),
  normalizedAt: text("normalized_at").notNull(),
  freshUntil: text("fresh_until").notNull().default("1970-01-01T00:00:00.000Z"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const analysisCache = sqliteTable("analysis_cache", {
  listingId: text("listing_id").primaryKey().references(() => listings.id, { onDelete: "cascade" }),
  payloadJson: text("payload_json").notNull(),
  schemaVersion: integer("schema_version").notNull().default(2),
  normalizationVersion: text("normalization_version").notNull().default("legacy"),
  valuationModelVersion: text("valuation_model_version").notNull().default("legacy"),
  scoreModelVersion: text("score_model_version").notNull().default("legacy"),
  componentSourceVersionsJson: text("component_source_versions_json").notNull().default("{}"),
  generatedAt: text("generated_at").notNull(),
  freshUntil: text("fresh_until").notNull(),
  refreshStartedAt: text("refresh_started_at"),
  lastRefreshError: text("last_refresh_error"),
  lastSuccessfulRefresh: text("last_successful_refresh"),
  jsonBytes: integer("json_bytes").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_analysis_cache_fresh_until").on(table.freshUntil),
]);

export const componentCache = sqliteTable("component_cache", {
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  component: text("component").notNull(),
  payloadJson: text("payload_json").notNull(),
  provider: text("provider"),
  sourceVersion: text("source_version").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  freshUntil: text("fresh_until").notNull(),
  lastSuccessfulRefresh: text("last_successful_refresh").notNull(),
  lastRefreshError: text("last_refresh_error"),
  jsonBytes: integer("json_bytes").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.listingId, table.component] }),
  index("idx_component_cache_component_fresh_until").on(table.component, table.freshUntil),
]);

export const priceHistoryCache = sqliteTable("price_history_cache", {
  ticker: text("ticker").notNull(),
  range: text("range").notNull(),
  payloadJson: text("payload_json").notNull(),
  provider: text("provider").notNull(),
  sourceVersion: text("source_version").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  freshUntil: text("fresh_until").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.ticker, table.range] }),
  index("idx_price_history_cache_fresh_until").on(table.freshUntil),
]);

export const referenceDataCache = sqliteTable("reference_data_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  provider: text("provider").notNull(),
  sourceVersion: text("source_version").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  freshUntil: text("fresh_until").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_reference_data_cache_fresh_until").on(table.freshUntil),
]);

export const cacheEvents = sqliteTable("cache_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: text("listing_id"),
  ticker: text("ticker").notNull(),
  component: text("component").notNull(),
  outcome: text("outcome").notNull(),
  durationMs: integer("duration_ms"),
  jsonBytes: integer("json_bytes"),
  provider: text("provider"),
  error: text("error"),
  sampleWeight: integer("sample_weight").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_cache_events_component_created_at").on(table.component, table.createdAt),
  index("idx_cache_events_listing_created_at").on(table.listingId, table.createdAt),
]);

export const cacheRefreshSchedule = sqliteTable("cache_refresh_schedule", {
  listingId: text("listing_id").primaryKey().references(() => listings.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  viewCount: integer("view_count").notNull().default(1),
  priority: integer("priority").notNull().default(0),
  lastViewedAt: text("last_viewed_at").notNull(),
  nextRefreshAt: text("next_refresh_at").notNull(),
  lastScheduledRefresh: text("last_scheduled_refresh"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_cache_refresh_schedule_due").on(table.nextRefreshAt, table.priority, table.viewCount),
]);

export const cacheRefreshLeases = sqliteTable("cache_refresh_leases", {
  cacheKey: text("cache_key").primaryKey(),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("idx_cache_refresh_leases_expires_at").on(table.expiresAt),
]);

export const scalingBuildResults = sqliteTable("scaling_build_results", {
  buildKey: text("build_key").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  completedAt: text("completed_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("idx_scaling_build_results_expires_at").on(table.expiresAt),
]);

export const requestRateLimits = sqliteTable("request_rate_limits", {
  counterKey: text("counter_key").primaryKey(),
  requestCount: integer("request_count").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("idx_request_rate_limits_expires_at").on(table.expiresAt),
]);

export const providerRequestBudgets = sqliteTable("provider_request_budgets", {
  providerKey: text("provider_key").primaryKey(),
  nextAvailableAt: integer("next_available_at").notNull(),
});

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  preferredAiProvider: text("preferred_ai_provider").notNull().default("openrouter"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_user_profiles_email").on(table.email),
]);

export const userAiCredentials = sqliteTable("user_ai_credentials", {
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  keyCiphertext: text("key_ciphertext").notNull(),
  keyIv: text("key_iv").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.provider] }),
]);

export const favoriteStocks = sqliteTable("favorite_stocks", {
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.ticker] }),
  index("idx_favorite_stocks_user_created_at").on(table.userId, table.createdAt),
]);

export const peerSelectionRuns = sqliteTable("peer_selection_runs", {
  id: text("id").primaryKey(),
  targetListingId: text("target_listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  sourceProvider: text("source_provider").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceAsOf: text("source_as_of").notNull(),
  selectionVersion: text("selection_version").notNull(),
  targetSector: text("target_sector"),
  targetIndustry: text("target_industry"),
  candidateCount: integer("candidate_count").notNull(),
  selectedCount: integer("selected_count").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_peer_selection_runs_target_created_at").on(table.targetListingId, table.createdAt),
]);

export const peerSelections = sqliteTable("peer_selections", {
  runId: text("run_id").notNull().references(() => peerSelectionRuns.id, { onDelete: "cascade" }),
  peerTicker: text("peer_ticker").notNull(),
  peerName: text("peer_name").notNull(),
  rank: integer("rank").notNull(),
  scoreBasisPoints: integer("score_basis_points").notNull(),
  reason: text("reason").notNull(),
  factorsJson: text("factors_json").notNull(),
  sourceLabel: text("source_label").notNull(),
  sourceUrl: text("source_url").notNull(),
  marketCap: integer("market_cap"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.runId, table.peerTicker] }),
  index("idx_peer_selections_peer_ticker").on(table.peerTicker),
]);
