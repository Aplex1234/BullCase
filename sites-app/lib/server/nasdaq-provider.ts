import { scheduleBackgroundRefresh } from "./analysis-cache.ts";
import { readReferenceCache, writeReferenceCache } from "./reference-cache.ts";
import type { AnalystEstimateRow, AnalystEstimates, NasdaqProfile, NasdaqScreenerRow, Quote } from "./analysis-types.ts";
import { nasdaqClient } from "./nasdaq-client.ts";
import { providerInvalidResponse } from "./provider-http.ts";

const COMPS_CACHE_TTL_MS = 15 * 60 * 1000;
const NASDAQ_UNIVERSE_TTL_MS = 6 * 60 * 60 * 1000;
const NASDAQ_PROFILE_SOURCE_VERSION = "nasdaq-profile-v1";
const NASDAQ_UNIVERSE_SOURCE_VERSION = "nasdaq-universe-v1";
const profileCache = new Map<string, { expiresAt: number; profile: NasdaqProfile }>();
let nasdaqUniverseCache: { expiresAt: number; rows: NasdaqScreenerRow[]; asOf: string } | null = null;

async function fetchNasdaqProfileLive(ticker: string): Promise<NasdaqProfile> {
  const normalizedTicker = ticker.toUpperCase();
  const payload = await nasdaqClient.getCompanyProfile<{
    data?: Record<string, { value?: string | null }>;
  }>(ticker);
  const profile = {
    name: payload.data?.CompanyName?.value ?? null,
    sector: payload.data?.Sector?.value ?? null,
    industry: payload.data?.Industry?.value ?? null,
    description: payload.data?.CompanyDescription?.value ?? null,
  };
  profileCache.set(normalizedTicker, { expiresAt: Date.now() + NASDAQ_UNIVERSE_TTL_MS, profile });
  await writeReferenceCache(
    `nasdaq-profile:${normalizedTicker}`,
    profile,
    NASDAQ_PROFILE_SOURCE_VERSION,
    "Nasdaq company profile",
    NASDAQ_UNIVERSE_TTL_MS,
  );
  return profile;
}

export async function fetchNasdaqProfile(ticker: string): Promise<NasdaqProfile> {
  const normalizedTicker = ticker.toUpperCase();
  const memoryCached = profileCache.get(normalizedTicker);
  if (memoryCached && memoryCached.expiresAt > Date.now()) return memoryCached.profile;
  const persisted = await readReferenceCache<NasdaqProfile>(
    `nasdaq-profile:${normalizedTicker}`,
    NASDAQ_PROFILE_SOURCE_VERSION,
  );
  if (persisted) {
    profileCache.set(normalizedTicker, {
      expiresAt: persisted.isFresh ? Date.parse(persisted.freshUntil) : Date.now() + COMPS_CACHE_TTL_MS,
      profile: persisted.data,
    });
    if (!persisted.isFresh) {
      const refresh = fetchNasdaqProfileLive(normalizedTicker).catch(() => persisted.data);
      if (!await scheduleBackgroundRefresh(refresh)) refresh.catch(() => undefined);
    }
    return persisted.data;
  }
  return fetchNasdaqProfileLive(normalizedTicker);
}

function nullableNumber(value: unknown) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function fetchAnalystEstimates(ticker: string): Promise<AnalystEstimates> {
  const payload = await nasdaqClient.getAnalystForecast<{
    data?: {
      quarterlyForecast?: { asOf?: string | null; rows?: Array<Record<string, unknown>> };
      yearlyForecast?: { asOf?: string | null; rows?: Array<Record<string, unknown>> };
    };
  }>(ticker);
  const normalizeRows = (rows: Array<Record<string, unknown>> | undefined): AnalystEstimateRow[] =>
    (rows ?? []).map((row) => ({
      period: String(row.fiscalEnd ?? ""),
      consensus_eps: nullableNumber(row.consensusEPSForecast),
      high_eps: nullableNumber(row.highEPSForecast),
      low_eps: nullableNumber(row.lowEPSForecast),
      analyst_count: nullableNumber(row.noOfEstimates),
      revisions_up: nullableNumber(row.up),
      revisions_down: nullableNumber(row.down),
    })).filter((row) => row.period);

  return {
    quarterly: normalizeRows(payload.data?.quarterlyForecast?.rows),
    annual: normalizeRows(payload.data?.yearlyForecast?.rows),
    provider: "Nasdaq analyst consensus",
    as_of: payload.data?.quarterlyForecast?.asOf ?? payload.data?.yearlyForecast?.asOf ?? null,
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/earnings`,
    disclosure: "Analyst EPS estimates are consensus forecasts, not company guidance.",
  };
}

export function cleanedScreenerName(name: string) {
  return name
    .replace(/\b(class [a-z]|common stock|ordinary shares?|american depositary shares?|depositary shares?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOperatingCommonStock(name: string) {
  return !/\b(preferred|preference|warrant|right|unit|note|bond|debenture|mandatory convertible|beneficial interest)\b/i.test(name);
}

export function issuerNameKey(name: string) {
  return cleanedScreenerName(name)
    .toLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function compactNasdaqStockUniverse(rows: NasdaqScreenerRow[]) {
  return rows
    .map((row) => ({
      symbol: String(row.symbol ?? "").trim().toUpperCase(),
      name: String(row.name ?? "").trim(),
      marketCap: String(row.marketCap ?? "").replaceAll(",", ""),
      sector: String(row.sector ?? "").trim(),
      industry: String(row.industry ?? "").trim(),
    }))
    .filter((row) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(row.symbol)
      && Number.isFinite(Number(row.marketCap))
      && Number(row.marketCap) > 0
      && isOperatingCommonStock(row.name));
}

async function fetchNasdaqStockUniverseLive() {
  const params = new URLSearchParams({ tableonly: "false", limit: "25", offset: "0", download: "true" });
  const payload = await nasdaqClient.getStockUniverse<{
    data?: { asOf?: string; rows?: NasdaqScreenerRow[] };
  }>(params);
  const result = {
    rows: compactNasdaqStockUniverse(payload.data?.rows ?? []),
    asOf: payload.data?.asOf ?? new Date().toISOString(),
    expiresAt: Date.now() + NASDAQ_UNIVERSE_TTL_MS,
  };
  nasdaqUniverseCache = result;
  await writeReferenceCache(
    "nasdaq-stock-universe",
    { rows: result.rows, asOf: result.asOf },
    NASDAQ_UNIVERSE_SOURCE_VERSION,
    "Nasdaq stock screener",
    NASDAQ_UNIVERSE_TTL_MS,
  ).catch(() => undefined);
  return result;
}

export async function fetchNasdaqStockUniverse() {
  if (nasdaqUniverseCache && nasdaqUniverseCache.expiresAt > Date.now()) return nasdaqUniverseCache;
  const persisted = await readReferenceCache<{ rows: NasdaqScreenerRow[]; asOf: string }>(
    "nasdaq-stock-universe",
    NASDAQ_UNIVERSE_SOURCE_VERSION,
  );
  if (persisted) {
    const result = {
      rows: persisted.data.rows,
      asOf: persisted.data.asOf,
      expiresAt: persisted.isFresh ? Date.parse(persisted.freshUntil) : Date.now() + COMPS_CACHE_TTL_MS,
    };
    nasdaqUniverseCache = result;
    if (!persisted.isFresh) {
      const refresh = fetchNasdaqStockUniverseLive().catch(() => result);
      if (!await scheduleBackgroundRefresh(refresh)) refresh.catch(() => undefined);
    }
    return result;
  }
  return fetchNasdaqStockUniverseLive();
}

export async function fetchPopularUniverseTickers(limit = 100) {
  const universe = await fetchNasdaqStockUniverse();
  return universe.rows
    .map((row) => ({
      ticker: String(row.symbol ?? "").trim().toUpperCase(),
      name: String(row.name ?? ""),
      marketCap: Number(String(row.marketCap ?? "").replaceAll(",", "")),
    }))
    .filter((row) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(row.ticker) && Number.isFinite(row.marketCap) && row.marketCap > 0 && isOperatingCommonStock(row.name))
    .sort((left, right) => right.marketCap - left.marketCap)
    .slice(0, Math.max(0, limit))
    .map((row) => row.ticker);
}

export async function fetchQuote(ticker: string): Promise<Quote> {
  const [payload, summary] = await Promise.all([
    nasdaqClient.getQuoteInfo<{
      data?: {
        primaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string; isRealTime?: boolean };
        secondaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string; isRealTime?: boolean };
      };
    }>(ticker),
    nasdaqClient.getQuoteSummary<{
      data?: { summaryData?: { MarketCap?: { value?: string | null } } };
    }>(ticker).catch(() => null),
  ]);
  const primary = payload.data?.primaryData ?? payload.data?.secondaryData;
  if (!primary) {
    throw providerInvalidResponse("Nasdaq", "quote_info", ticker, "Nasdaq did not return quote data");
  }
  const price = Number(String(primary?.lastSalePrice ?? "").replaceAll("$", "").replaceAll(",", ""));
  if (!Number.isFinite(price) || price <= 0) {
    throw providerInvalidResponse("Nasdaq", "quote_info", ticker, "Nasdaq did not return a usable delayed price");
  }
  const date = String(primary.lastTradeTimestamp ?? "").match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)?.[0] ?? String(primary.lastTradeTimestamp);
  let marketCap: number | null = null;
  if (summary) {
    const parsed = Number(String(summary.data?.summaryData?.MarketCap?.value ?? "").replaceAll("$", "").replaceAll(",", ""));
    if (Number.isFinite(parsed) && parsed > 0) marketCap = parsed;
  }
  return {
    price,
    market_cap: marketCap,
    as_of: date,
    currency: "USD",
    provider: "Nasdaq delayed quote",
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}`,
    is_delayed: !primary.isRealTime,
  };
}
