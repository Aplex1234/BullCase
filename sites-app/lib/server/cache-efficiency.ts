const CACHE_HIT_SAMPLE_WEIGHT = 64;
const COMPANY_VIEW_FLUSH_INTERVAL_MS = 60_000;
const DUE_REFRESH_CHECK_INTERVAL_MS = 5 * 60_000;

export type AggregatedViewState = Map<string, { pending: number; nextFlushAt: number }>;

export function cacheEventSampleWeight(outcome: string, random = Math.random()) {
  if (outcome !== "hit") return 1;
  return random < 1 / CACHE_HIT_SAMPLE_WEIGHT ? CACHE_HIT_SAMPLE_WEIGHT : 0;
}

export function takeAggregatedViewDelta(
  state: AggregatedViewState,
  key: string,
  now = Date.now(),
  flushIntervalMs = COMPANY_VIEW_FLUSH_INTERVAL_MS,
) {
  const current = state.get(key);
  if (!current) {
    state.set(key, { pending: 0, nextFlushAt: now + flushIntervalMs });
    if (state.size > 512) {
      const oldest = state.keys().next().value as string | undefined;
      if (oldest) state.delete(oldest);
    }
    return 1;
  }
  current.pending += 1;
  if (now < current.nextFlushAt) return 0;
  const delta = current.pending;
  current.pending = 0;
  current.nextFlushAt = now + flushIntervalMs;
  return delta;
}

export function claimThrottledWork(
  state: Map<string, number>,
  key: string,
  now = Date.now(),
  intervalMs = DUE_REFRESH_CHECK_INTERVAL_MS,
) {
  const nextAllowedAt = state.get(key) ?? 0;
  if (now < nextAllowedAt) return false;
  state.set(key, now + intervalMs);
  return true;
}
