// Compatibility facade for cache consumers. Each concern lives in a focused module.
export {
  isAnalysisCacheCompatible,
  parseCachedAnalysisRow,
  readCachedAnalysis,
  writeAnalysisSnapshot,
  writeCachedAnalysis,
  type CachedAnalysis,
} from "./analysis-snapshot-cache.ts";
export {
  cacheIdentity,
  getCacheDatabase,
  type D1Database,
} from "./cache-database.ts";
export { CACHE_TTLS } from "./cache-policy.ts";
export {
  getCacheMonitoringSummary,
  pruneCacheEvents,
  recordProviderFailure,
  writePeerSelectionAudit,
} from "./cache-telemetry.ts";
export {
  readComponentCache,
  writeComponentCache,
  type CachedComponent,
  type CachedEstimates,
  type CachedPeers,
  type CachedQuote,
  type ComponentName,
} from "./component-cache.ts";
export {
  extendFinancialFreshness,
  hasSameFinancialFingerprint,
  readFinancialSourceCache,
  writeFinancialSourceCache,
  type CachedFinancialSource,
} from "./financial-source-cache.ts";
export {
  readHotAnalysisCache,
  writeHotAnalysisCache,
} from "./hot-analysis-cache.ts";
export {
  acquireCacheRefreshLease,
  acquireRefreshLease,
  listDueRefreshTickers,
  listUncachedTickers,
  markScheduledRefresh,
  recordCompanyView,
  recordCompanyViewInBackground,
  recordRefreshFailure,
  releaseCacheRefreshLease,
  scheduleBackgroundRefresh,
  shouldCheckForDueRefresh,
} from "./cache-refresh.ts";
