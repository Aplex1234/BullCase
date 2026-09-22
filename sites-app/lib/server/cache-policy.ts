export const CACHE_TTLS = {
  analysis: 5 * 60 * 1000,
  quote: 10 * 60 * 1000,
  analyst_estimates: 12 * 60 * 60 * 1000,
  comps: 2 * 60 * 60 * 1000,
  risks: 30 * 24 * 60 * 60 * 1000,
  news: 20 * 60 * 1000,
  financial_check: 12 * 60 * 60 * 1000,
  popular_refresh: 30 * 60 * 1000,
} as const;

export const REFRESH_LEASE_MS = 2 * 60 * 1000;
export const HOT_ANALYSIS_TTL_MS = 30 * 1000;
export const HOT_ANALYSIS_MAX_ENTRIES = 64;
