import type { SecuritySearchResult } from "./types";

export const RECENT_SECURITIES_KEY = "aplex-recent-securities";
export const RECENT_SECURITIES_LIMIT = 5;

type RecentStorage = Pick<Storage, "getItem" | "setItem">;

export function loadRecentSecurities(getStorage: () => RecentStorage = () => window.localStorage): SecuritySearchResult[] {
  try {
    return parseRecentSecurities(getStorage().getItem(RECENT_SECURITIES_KEY));
  } catch {
    // Device-local history is optional; blocked storage must not break research.
    return [];
  }
}

export function saveRecentSecurities(recent: SecuritySearchResult[], getStorage: () => RecentStorage = () => window.localStorage): void {
  try {
    getStorage().setItem(RECENT_SECURITIES_KEY, JSON.stringify(recent));
  } catch {
    // Keep the in-memory list usable when storage is blocked or full.
  }
}

function isSecurityResult(value: unknown): value is SecuritySearchResult {
  return typeof value === "object"
    && value !== null
    && typeof (value as SecuritySearchResult).ticker === "string"
    && typeof (value as SecuritySearchResult).name === "string";
}

export function parseRecentSecurities(value: string | null): SecuritySearchResult[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(isSecurityResult).slice(0, RECENT_SECURITIES_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function addRecentSecurity(
  current: SecuritySearchResult[],
  result: SecuritySearchResult,
): SecuritySearchResult[] {
  return [result, ...current.filter((item) => item.ticker !== result.ticker)]
    .slice(0, RECENT_SECURITIES_LIMIT);
}

export function mergeSecurityOptions(
  results: SecuritySearchResult[],
  recent: SecuritySearchResult[],
) {
  const resultTickers = new Set(results.map((item) => item.ticker));
  const uniqueRecent = recent.filter((item) => !resultTickers.has(item.ticker));
  return { uniqueRecent, options: [...results, ...uniqueRecent] };
}
