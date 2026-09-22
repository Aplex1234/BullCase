import type { Analysis } from "@/lib/types";
import { HOT_ANALYSIS_MAX_ENTRIES, HOT_ANALYSIS_TTL_MS } from "./cache-policy.ts";

export type CachedAnalysis = {
  analysis: Analysis;
  listingId: string;
  generatedAt: string;
  freshUntil: string;
  isFresh: boolean;
};

type HotAnalysisEntry = {
  cached: CachedAnalysis;
  expiresAt: number;
};

const hotAnalysisCache = new Map<string, HotAnalysisEntry>();

export function readHotAnalysisCache(ticker: string, now = Date.now()): CachedAnalysis | null {
  const key = ticker.trim().toUpperCase();
  const entry = hotAnalysisCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    hotAnalysisCache.delete(key);
    return null;
  }
  hotAnalysisCache.delete(key);
  hotAnalysisCache.set(key, entry);
  return { ...entry.cached, isFresh: Date.parse(entry.cached.freshUntil) > now };
}

export function writeHotAnalysisCache(ticker: string, cached: CachedAnalysis, now = Date.now()) {
  const key = ticker.trim().toUpperCase();
  hotAnalysisCache.delete(key);
  hotAnalysisCache.set(key, { cached, expiresAt: now + HOT_ANALYSIS_TTL_MS });
  while (hotAnalysisCache.size > HOT_ANALYSIS_MAX_ENTRIES) {
    const oldestKey = hotAnalysisCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    hotAnalysisCache.delete(oldestKey);
  }
}
