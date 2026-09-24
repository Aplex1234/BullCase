import type { Analysis, AnalysisSection, DcfAssumptions } from "@/lib/types";
import {
  buildAnalysis,
  fetchAnalystEstimates,
  fetchCompanyRisks,
  fetchComparableCompanies,
  fetchFinancialFingerprint,
  fetchFinancialSource,
  fetchPopularUniverseTickers,
  fetchQuote,
  type AnalystEstimates,
  type CompanyRisk,
  type FinancialSource,
  type PeerSet,
  type Quote,
} from "./analysis.ts";
import {
  acquireCacheRefreshLease,
  CACHE_TTLS,
  extendFinancialFreshness,
  hasSameFinancialFingerprint,
  listDueRefreshTickers,
  listUncachedTickers,
  markScheduledRefresh,
  readComponentCache,
  readFinancialSourceCache,
  recordCompanyViewInBackground,
  recordProviderFailure,
  releaseCacheRefreshLease,
  scheduleBackgroundRefresh,
  writeAnalysisSnapshot,
  writeComponentCache,
  writeFinancialSourceCache,
  writePeerSelectionAudit,
  type CachedComponent,
  type CachedFinancialSource,
} from "./analysis-cache.ts";
import { COMPONENT_SOURCE_VERSIONS } from "./model-versions.ts";
import { emptyNewsFeed, fetchCompanyNews, type NewsFeed } from "./news.ts";
import { FinancialDataUnavailableError, SourceDataUnavailableError } from "./provider-errors.ts";
import { normalizeTicker } from "./security-master.ts";
import { coordinateAnalysisBuild } from "./scaling-protection.ts";
import { persistPeerResult } from "./peer-persistence.ts";

type SourceStatus = "live" | "cached" | "stale" | "unavailable";
type FreshnessItem = {
  status: SourceStatus;
  as_of: string | null;
  fresh_until: string | null;
  source: string;
};

type Loaded<T> = {
  data: T | null;
  freshness: FreshnessItem;
  cached?: CachedComponent<T> | null;
};

const ALL_ANALYSIS_SECTIONS: AnalysisSection[] = [
  "overview", "financials", "valuation", "buyTarget", "comps", "earnings", "news", "filings", "risks", "research",
];

function freshness(status: SourceStatus, asOf: string | null, freshUntil: string | null, source: string): FreshnessItem {
  return { status, as_of: asOf, fresh_until: freshUntil, source };
}

async function scheduleSharedRefresh(cacheKey: string, task: () => Promise<unknown>) {
  if (!await acquireCacheRefreshLease(cacheKey)) return false;
  const guarded = task().finally(() => releaseCacheRefreshLease(cacheKey));
  if (!await scheduleBackgroundRefresh(guarded)) void guarded.catch(() => undefined);
  return true;
}

async function loadFinancials(ticker: string, forceRefresh = false): Promise<{
  data: FinancialSource | null;
  cache: CachedFinancialSource | null;
  freshness: FreshnessItem;
  warnings: string[];
}> {
  const cached = await readFinancialSourceCache(ticker);
  if (cached?.isFresh && !forceRefresh) {
    return {
      data: cached.source,
      cache: cached,
      freshness: freshness("cached", cached.sourceFilingAt ?? cached.normalizedAt, cached.freshUntil, "Normalized SEC cache"),
      warnings: [],
    };
  }

  if (cached && !forceRefresh) {
    try {
      const fingerprint = await fetchFinancialFingerprint(ticker);
      if (hasSameFinancialFingerprint(cached, fingerprint)) {
        const extended = await extendFinancialFreshness(ticker, cached, fingerprint);
        return {
          data: extended.source,
          cache: extended,
          freshness: freshness("cached", extended.sourceFilingAt ?? extended.normalizedAt, extended.freshUntil, "Normalized SEC cache; filing unchanged"),
          warnings: [],
        };
      }
    } catch (error) {
      await recordProviderFailure(ticker, "financials", error, cached.listingId);
      return {
        data: cached.source,
        cache: cached,
        freshness: freshness("stale", cached.sourceFilingAt ?? cached.normalizedAt, cached.freshUntil, "Last successful normalized SEC cache"),
        warnings: ["The SEC freshness check was unavailable. Showing the last successfully normalized filing data."],
      };
    }
  }

  try {
    const source = await fetchFinancialSource(ticker, false);
    const stored = await writeFinancialSourceCache(ticker, source);
    return {
      data: source,
      cache: null,
      freshness: freshness("live", stored?.fingerprint.filingDate ?? source.periods.at(-1)?.filed_at ?? null, stored?.freshUntil ?? null, "SEC EDGAR normalized now"),
      warnings: [],
    };
  } catch (error) {
    if (cached) {
      await recordProviderFailure(ticker, "financials", error, cached.listingId);
      return {
        data: cached.source,
        cache: cached,
        freshness: freshness("stale", cached.sourceFilingAt ?? cached.normalizedAt, cached.freshUntil, "Last successful normalized SEC cache"),
        warnings: ["A newer SEC filing may exist, but refresh failed. Showing the last successful normalized data."],
      };
    }
    await recordProviderFailure(ticker, "financials", error);
    throw error;
  }
}

async function loadQuote(ticker: string, financials: FinancialSource | null, forceRefresh = false): Promise<Loaded<Quote>> {
  const cached = await readComponentCache<Quote>(ticker, "quote", COMPONENT_SOURCE_VERSIONS.quote);
  if (cached?.isFresh && !forceRefresh) return { data: cached.data, cached, freshness: freshness("cached", cached.data.as_of, cached.freshUntil, cached.provider ?? "Cached quote") };
  if (cached && !forceRefresh) {
    await scheduleSharedRefresh(`quote:${ticker}`, async () => {
      try {
        const quote = await fetchQuote(ticker);
        if (financials) await writeComponentCache(ticker, financials.profile, "quote", quote, COMPONENT_SOURCE_VERSIONS.quote, CACHE_TTLS.quote, quote.provider, Date.now());
      } catch (error) {
        await recordProviderFailure(ticker, "quote", error, cached.listingId);
      }
    });
    return { data: cached.data, cached, freshness: freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful quote; refreshing") };
  }
  const refreshStartedAt = Date.now();
  try {
    const quote = await fetchQuote(ticker);
    const stored = financials
      ? await writeComponentCache(ticker, financials.profile, "quote", quote, COMPONENT_SOURCE_VERSIONS.quote, CACHE_TTLS.quote, quote.provider, refreshStartedAt)
      : null;
    return { data: quote, freshness: freshness("live", quote.as_of, stored?.freshUntil ?? null, quote.provider) };
  } catch (error) {
    await recordProviderFailure(ticker, "quote", error, cached?.listingId);
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful quote") };
    throw error;
  }
}

async function loadEstimates(ticker: string, financials: FinancialSource | null, forceRefresh = false): Promise<Loaded<AnalystEstimates>> {
  const withAvailability = (
    data: AnalystEstimates,
    item: FreshnessItem,
  ): FreshnessItem => data.quarterly.length || data.annual.length
    ? item
    : freshness("unavailable", data.as_of, null, "No analyst consensus estimates returned by Nasdaq");
  const cached = await readComponentCache<AnalystEstimates>(ticker, "analyst_estimates", COMPONENT_SOURCE_VERSIONS.analyst_estimates);
  if (cached?.isFresh && !forceRefresh) {
    const item = freshness("cached", cached.data.as_of, cached.freshUntil, cached.provider ?? "Cached analyst estimates");
    return { data: cached.data, cached, freshness: withAvailability(cached.data, item) };
  }
  if (cached && !forceRefresh) {
    await scheduleSharedRefresh(`analyst-estimates:${ticker}`, async () => {
      try {
        const estimates = await fetchAnalystEstimates(ticker);
        if (financials) await writeComponentCache(ticker, financials.profile, "analyst_estimates", estimates, COMPONENT_SOURCE_VERSIONS.analyst_estimates, CACHE_TTLS.analyst_estimates, estimates.provider, Date.now());
      } catch (error) {
        await recordProviderFailure(ticker, "analyst_estimates", error, cached.listingId);
      }
    });
    const item = freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful estimates; refreshing");
    return { data: cached.data, cached, freshness: withAvailability(cached.data, item) };
  }
  const refreshStartedAt = Date.now();
  try {
    const estimates = await fetchAnalystEstimates(ticker);
    const stored = financials
      ? await writeComponentCache(ticker, financials.profile, "analyst_estimates", estimates, COMPONENT_SOURCE_VERSIONS.analyst_estimates, CACHE_TTLS.analyst_estimates, estimates.provider, refreshStartedAt)
      : null;
    const item = freshness("live", estimates.as_of, stored?.freshUntil ?? null, estimates.provider);
    return { data: estimates, freshness: withAvailability(estimates, item) };
  } catch (error) {
    await recordProviderFailure(ticker, "analyst_estimates", error, cached?.listingId);
    if (cached) {
      const item = freshness("stale", cached.data.as_of, cached.freshUntil, cached.provider ?? "Last successful estimates");
      return { data: cached.data, cached, freshness: withAvailability(cached.data, item) };
    }
    throw error;
  }
}

function annualRiskVersion(financials: FinancialSource) {
  const annual = financials.filings.find((filing) => ["10-K", "20-F", "40-F"].includes(filing.form));
  return {
    annual,
    sourceVersion: `${COMPONENT_SOURCE_VERSIONS.risks}:${annual?.accession_number || "none"}`,
  };
}

async function loadRisks(ticker: string, financials: FinancialSource | null, forceRefresh = false): Promise<Loaded<CompanyRisk[]>> {
  if (!financials) throw new FinancialDataUnavailableError(ticker);
  const { annual, sourceVersion } = annualRiskVersion(financials);
  if (!annual) throw new SourceDataUnavailableError("Annual filing risk disclosures are unavailable for this company.");
  const cached = await readComponentCache<CompanyRisk[]>(ticker, "risks", sourceVersion);
  if (cached?.isFresh && !forceRefresh) return { data: cached.data, cached, freshness: freshness("cached", annual.filing_date, cached.freshUntil, cached.provider ?? "Cached annual filing risks") };
  if (forceRefresh) {
    const refreshStartedAt = Date.now();
    try {
      const risks = await fetchCompanyRisks(financials);
      if (!risks.length) throw new SourceDataUnavailableError("Risk disclosures could not be extracted from the latest annual filing.");
      const stored = await writeComponentCache(ticker, financials.profile, "risks", risks, sourceVersion, CACHE_TTLS.risks, "SEC annual filing", refreshStartedAt);
      return { data: risks, freshness: freshness("live", annual.filing_date, stored?.freshUntil ?? null, "SEC annual filing") };
    } catch (error) {
      await recordProviderFailure(ticker, "risks", error, cached?.listingId);
      if (cached) return { data: cached.data, cached, freshness: freshness("stale", annual.filing_date, cached.freshUntil, cached.provider ?? "Last successful annual filing risks") };
      throw error;
    }
  }
  if (cached) {
    await scheduleSharedRefresh(`risks:${ticker}:${annual.accession_number}`, async () => {
      try {
        const risks = await fetchCompanyRisks(financials);
        if (!risks.length) throw new SourceDataUnavailableError("Risk disclosures could not be extracted from the latest annual filing.");
        await writeComponentCache(ticker, financials.profile, "risks", risks, sourceVersion, CACHE_TTLS.risks, "SEC annual filing", Date.now());
      } catch (error) {
        await recordProviderFailure(ticker, "risks", error, cached.listingId);
      }
    });
    return { data: cached.data, cached, freshness: freshness("stale", annual.filing_date, cached.freshUntil, cached.provider ?? "Last successful annual filing risks; refreshing") };
  }
  const refreshStartedAt = Date.now();
  try {
    const risks = await fetchCompanyRisks(financials);
    if (!risks.length) throw new SourceDataUnavailableError("Risk disclosures could not be extracted from the latest annual filing.");
    const stored = await writeComponentCache(ticker, financials.profile, "risks", risks, sourceVersion, CACHE_TTLS.risks, "SEC annual filing", refreshStartedAt);
    return { data: risks, freshness: freshness("live", annual.filing_date, stored?.freshUntil ?? null, "SEC annual filing") };
  } catch (error) {
    await recordProviderFailure(ticker, "risks", error);
    throw error;
  }
}

function newsProviderLabel(feed: NewsFeed) {
  return feed.providers.length ? feed.providers.join(", ") : "News coverage";
}

async function loadNews(ticker: string, financials: FinancialSource | null, forceRefresh = false): Promise<Loaded<NewsFeed>> {
  const cached = await readComponentCache<NewsFeed>(ticker, "news", COMPONENT_SOURCE_VERSIONS.news);
  if (cached?.isFresh && !forceRefresh) {
    return { data: cached.data, cached, freshness: freshness("cached", cached.data.fetched_at, cached.freshUntil, cached.provider ?? newsProviderLabel(cached.data)) };
  }
  if (!financials) {
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.data.fetched_at, cached.freshUntil, cached.provider ?? newsProviderLabel(cached.data)) };
    throw new FinancialDataUnavailableError(ticker);
  }
  const refresh = async () => {
    const feed = await fetchCompanyNews({ ticker, ...financials.profile }, financials.filings);
    if (feed.warnings.length) await recordProviderFailure(ticker, "news", new Error(feed.warnings.join(" ")), cached?.listingId);
    return writeComponentCache(ticker, financials.profile, "news", feed, COMPONENT_SOURCE_VERSIONS.news, CACHE_TTLS.news, newsProviderLabel(feed), Date.now());
  };
  if (cached && !forceRefresh) {
    await scheduleSharedRefresh(`news:${ticker}`, refresh);
    return { data: cached.data, cached, freshness: freshness("stale", cached.data.fetched_at, cached.freshUntil, `${cached.provider ?? newsProviderLabel(cached.data)}; refreshing`) };
  }
  try {
    const refreshStartedAt = Date.now();
    const feed = await fetchCompanyNews({ ticker, ...financials.profile }, financials.filings);
    if (feed.warnings.length) await recordProviderFailure(ticker, "news", new Error(feed.warnings.join(" ")));
    const stored = await writeComponentCache(ticker, financials.profile, "news", feed, COMPONENT_SOURCE_VERSIONS.news, CACHE_TTLS.news, newsProviderLabel(feed), refreshStartedAt);
    return { data: feed, freshness: freshness("live", feed.fetched_at, stored?.freshUntil ?? null, newsProviderLabel(feed)) };
  } catch (error) {
    await recordProviderFailure(ticker, "news", error, cached?.listingId);
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.data.fetched_at, cached.freshUntil, cached.provider ?? newsProviderLabel(cached.data)) };
    throw error;
  }
}

async function fetchAndStorePeers(
  ticker: string,
  financials: FinancialSource,
  quote: Quote | null,
): Promise<Loaded<PeerSet>> {
  return coordinateAnalysisBuild(`peer-component:${ticker}:${COMPONENT_SOURCE_VERSIONS.comps}`, async () => {
  const refreshStartedAt = Date.now();
  const peerSet = await fetchComparableCompanies(
    ticker,
    financials.profile,
    quote?.market_cap ?? null,
    financials.filings,
    async (peerTicker) => {
      const peerFinancials = await loadFinancials(peerTicker);
      if (!peerFinancials.data) throw new Error(`Financial data unavailable for ${peerTicker}`);
      const peerQuote = await loadQuote(peerTicker, peerFinancials.data);
      if (!peerQuote.data) throw new Error(`Quote unavailable for ${peerTicker}`);
      return { financials: peerFinancials.data, quote: peerQuote.data };
    },
  );
  const stored = await persistPeerResult(
    () => writeComponentCache(ticker, financials.profile, "comps", peerSet, COMPONENT_SOURCE_VERSIONS.comps, CACHE_TTLS.comps, "BullCase comps engine", refreshStartedAt),
    () => writePeerSelectionAudit(ticker, financials.profile, peerSet),
  );
  return { data: peerSet, freshness: freshness("live", stored?.fetchedAt ?? new Date().toISOString(), stored?.freshUntil ?? null, peerSet.methodology) };
  });
}

async function loadPeers(
  ticker: string,
  financials: FinancialSource | null,
  quote: Quote | null,
  forceRefresh = false,
): Promise<Loaded<PeerSet>> {
  const cached = await readComponentCache<PeerSet>(ticker, "comps", COMPONENT_SOURCE_VERSIONS.comps);
  if (cached?.isFresh && !forceRefresh) return { data: cached.data, cached, freshness: freshness("cached", cached.fetchedAt, cached.freshUntil, cached.data.methodology) };
  if (!financials) {
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.fetchedAt, cached.freshUntil, cached.data.methodology) };
    throw new FinancialDataUnavailableError(ticker);
  }
  if (cached && !forceRefresh) {
    await scheduleSharedRefresh(`comps:${ticker}`, async () => {
      try {
        await fetchAndStorePeers(ticker, financials, quote);
      } catch (error) {
        await recordProviderFailure(ticker, "comps", error, cached.listingId);
      }
    });
    return { data: cached.data, cached, freshness: freshness("stale", cached.fetchedAt, cached.freshUntil, `${cached.data.methodology}; refreshing`) };
  }
  try {
    return await fetchAndStorePeers(ticker, financials, quote);
  } catch (error) {
    console.error("[comps] retrieval failed", { ticker, error });
    await recordProviderFailure(ticker, "comps", error, cached?.listingId);
    if (cached) return { data: cached.data, cached, freshness: freshness("stale", cached.fetchedAt, cached.freshUntil, cached.data.methodology) };
    throw error;
  }
}

function attachFreshness(
  analysis: Analysis,
  pageStatus: "live" | "cached" | "refreshing" | "stale",
  items: {
    financials: FreshnessItem;
    quote: FreshnessItem;
    analystEstimates: FreshnessItem;
    comps: FreshnessItem;
    news: FreshnessItem;
    risks: FreshnessItem;
  },
) {
  return {
    ...analysis,
    freshness: {
      page_status: pageStatus,
      financials: items.financials,
      quote: items.quote,
      analyst_estimates: items.analystEstimates,
      comps: items.comps,
      news: items.news,
      risks: items.risks,
      summary: freshness(
        analysis.company.description_source === "BullCase summary" ? "cached" : "live",
        null,
        null,
        analysis.company.description_source,
      ),
    },
  } satisfies Analysis;
}

export function markSnapshotFreshness(analysis: Analysis, status: "cached" | "refreshing" | "stale") {
  if (!analysis.freshness) return analysis;
  const markCachedSource = (item: FreshnessItem): FreshnessItem => ({
    ...item,
    status: item.status === "unavailable"
      ? "unavailable"
      : item.fresh_until && Date.parse(item.fresh_until) <= Date.now()
        ? "stale"
        : "cached",
  });
  return {
    ...analysis,
    freshness: {
      page_status: status,
      financials: markCachedSource(analysis.freshness.financials),
      quote: markCachedSource(analysis.freshness.quote),
      analyst_estimates: markCachedSource(analysis.freshness.analyst_estimates),
      comps: markCachedSource(analysis.freshness.comps),
      news: markCachedSource(analysis.freshness.news),
      risks: markCachedSource(analysis.freshness.risks),
      summary: markCachedSource(analysis.freshness.summary),
    },
  };
}

export function buildOverviewSnapshot(analysis: Analysis): Analysis {
  const overviewFreshness = analysis.freshness ? {
    ...analysis.freshness,
    analyst_estimates: freshness("unavailable", null, null, "Loads with Earnings"),
    comps: freshness("unavailable", null, null, "Loads with Comps"),
    news: freshness("unavailable", null, null, "Loads with News"),
    risks: freshness("unavailable", null, null, "Loads with Risks"),
  } : analysis.freshness;
  return {
    ...analysis,
    freshness: overviewFreshness,
    data_scope: "overview",
    loaded_sections: ["overview"],
    financials: analysis.financials.map((period) => ({
      ...period,
      values: {
        revenue: period.values.revenue,
        operating_income: period.values.operating_income,
        free_cash_flow: period.values.free_cash_flow,
      },
      provenance: {},
    })),
    quarterly_financials: [],
    analyst_estimates: {
      quarterly: [],
      annual: [],
      provider: analysis.analyst_estimates.provider,
      as_of: analysis.analyst_estimates.as_of,
      source_url: analysis.analyst_estimates.source_url,
      disclosure: analysis.analyst_estimates.disclosure,
    },
    comps: [],
    filings: [],
    risks: [],
    news: emptyNewsFeed(),
  };
}

export function buildSectionSnapshot(analysis: Analysis, section: AnalysisSection): Analysis {
  if (section === "overview") return buildOverviewSnapshot(analysis);
  const overview = buildOverviewSnapshot(analysis);
  const needsDetailedFinancials = ["financials", "valuation", "buyTarget"].includes(section);
  const sectionFreshness = analysis.freshness && overview.freshness ? {
    ...overview.freshness,
    analyst_estimates: ["earnings", "financials"].includes(section)
      ? analysis.freshness.analyst_estimates
      : overview.freshness.analyst_estimates,
    comps: section === "comps" ? analysis.freshness.comps : overview.freshness.comps,
    news: section === "news" ? analysis.freshness.news : overview.freshness.news,
    risks: section === "risks" ? analysis.freshness.risks : overview.freshness.risks,
  } : overview.freshness;
  return {
    ...overview,
    freshness: sectionFreshness,
    data_scope: "partial",
    loaded_sections: ["overview", section],
    financials: needsDetailedFinancials ? analysis.financials : overview.financials,
    quarterly_financials: needsDetailedFinancials ? analysis.quarterly_financials : [],
    analyst_estimates: ["earnings", "financials"].includes(section) ? analysis.analyst_estimates : overview.analyst_estimates,
    comps: section === "comps" ? analysis.comps : [],
    filings: section === "filings" ? analysis.filings : [],
    risks: section === "risks" ? analysis.risks : [],
    news: section === "news" ? analysis.news : emptyNewsFeed(),
  };
}

function emptyEstimates(ticker: string): AnalystEstimates {
  return {
    quarterly: [],
    annual: [],
    provider: "Not loaded for Overview",
    as_of: null,
    source_url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/earnings`,
    disclosure: "Analyst estimates load when the Earnings section is opened.",
  };
}

function emptyPeerSet(): PeerSet {
  return {
    companies: [],
    methodology: "Comparable companies load separately from Overview",
    source_provider: "Not loaded for Overview",
    source_url: "https://www.nasdaq.com/market-activity/stocks/screener",
    source_as_of: new Date().toISOString(),
    candidates_considered: 0,
    selection_version: COMPONENT_SOURCE_VERSIONS.comps,
  };
}

export async function rebuildOverviewFromComponentCaches(rawTicker: string, forceRefresh = false) {
  const ticker = normalizeTicker(rawTicker);
  const [financials, initialQuote] = await Promise.all([
    loadFinancials(ticker, forceRefresh),
    loadQuote(ticker, null, forceRefresh),
  ]);
  if (!financials.data) throw new FinancialDataUnavailableError(ticker);
  if (!initialQuote.data) throw new SourceDataUnavailableError(`A market quote is unavailable for ${ticker}.`);
  let quote = initialQuote;
  if (financials.data && quote.data && !quote.cached && quote.freshness.status === "live") {
    const stored = await writeComponentCache(
      ticker,
      financials.data.profile,
      "quote",
      quote.data,
      COMPONENT_SOURCE_VERSIONS.quote,
      CACHE_TTLS.quote,
      quote.data.provider,
      Date.now(),
    );
    quote = {
      ...quote,
      freshness: freshness("live", quote.data.as_of, stored?.freshUntil ?? null, quote.data.provider),
    };
  }
  const analysis = await buildAnalysis(ticker, undefined, {
    allowUnavailableValuation: true,
    financials: financials.data ?? undefined,
    financialSourceMode: financials.data ? (financials.freshness.status === "live" ? "live-sec" : "normalized-cache") : undefined,
    quote: quote.data ?? undefined,
    analystEstimates: emptyEstimates(ticker),
    peerSet: emptyPeerSet(),
    newsFeed: emptyNewsFeed(),
    warnings: financials.warnings,
  });
  const enriched = attachFreshness(analysis, [financials.freshness, quote.freshness].some((item) => item.status === "stale") ? "stale" : "live", {
    financials: financials.freshness,
    quote: quote.freshness,
    analystEstimates: freshness("unavailable", null, null, "Loads with Earnings"),
    comps: freshness("unavailable", null, null, "Loads with Comps"),
    news: freshness("unavailable", null, null, "Loads with News"),
    risks: freshness("unavailable", null, null, "Loads with Risks"),
  });
  if (financials.cache?.listingId) void recordCompanyViewInBackground(ticker, financials.cache.listingId);
  return buildOverviewSnapshot(enriched);
}

export async function rebuildAnalysisSectionFromComponentCaches(rawTicker: string, section: AnalysisSection, forceRefresh = false) {
  if (section === "overview") return rebuildOverviewFromComponentCaches(rawTicker, forceRefresh);
  const ticker = normalizeTicker(rawTicker);
  const financials = await loadFinancials(ticker, forceRefresh);
  if (!financials.data) throw new FinancialDataUnavailableError(ticker);
  const quote = await loadQuote(ticker, financials.data, forceRefresh);
  if (!quote.data) throw new SourceDataUnavailableError(`A market quote is unavailable for ${ticker}.`);
  const estimates = ["earnings", "financials"].includes(section)
    ? await loadEstimates(ticker, financials.data, forceRefresh)
    : { data: emptyEstimates(ticker), freshness: freshness("unavailable", null, null, "Loads with Earnings") };
  const peers = section === "comps"
    ? await loadPeers(ticker, financials.data, quote.data, forceRefresh)
    : { data: emptyPeerSet(), freshness: freshness("unavailable", null, null, "Loads with Comps") };
  const risks = section === "risks"
    ? await loadRisks(ticker, financials.data, forceRefresh)
    : { data: [] as CompanyRisk[], freshness: freshness("unavailable", null, null, "Loads with Risks") };
  const news = section === "news"
    ? await loadNews(ticker, financials.data, forceRefresh)
    : { data: emptyNewsFeed(), freshness: freshness("unavailable", null, null, "Loads with News") };
  if (!estimates.data) throw new SourceDataUnavailableError(`Analyst estimates are unavailable for ${ticker}.`);
  if (!peers.data) throw new SourceDataUnavailableError(`Comparable-company data is unavailable for ${ticker}.`);
  if (!risks.data) throw new SourceDataUnavailableError(`Risk disclosures are unavailable for ${ticker}.`);
  if (!news.data) throw new SourceDataUnavailableError(`News coverage is unavailable for ${ticker}.`);
  const financialsForSection = { ...financials.data, filingRisks: risks.data };
  const analysis = await buildAnalysis(ticker, undefined, {
    allowUnavailableValuation: true,
    financials: financialsForSection,
    financialSourceMode: financials.freshness.status === "live" ? "live-sec" : "normalized-cache",
    quote: quote.data,
    analystEstimates: estimates.data,
    peerSet: peers.data,
    newsFeed: news.data,
    warnings: financials.warnings,
  });
  const pageStatus = [financials.freshness, quote.freshness, estimates.freshness, peers.freshness, risks.freshness, news.freshness]
    .some((item) => item.status === "stale") ? "stale" : "live";
  const enriched = attachFreshness(analysis, pageStatus, {
    financials: financials.freshness,
    quote: quote.freshness,
    analystEstimates: estimates.freshness,
    comps: peers.freshness,
    news: news.freshness,
    risks: risks.freshness,
  });
  return buildSectionSnapshot(enriched, section);
}

export async function loadResearchEvidence(rawTicker: string) {
  const ticker = normalizeTicker(rawTicker);
  return coordinateAnalysisBuild(`research-evidence:v1:${ticker}`, () => loadResearchEvidenceFromCaches(ticker));
}

async function loadResearchEvidenceFromCaches(ticker: string) {
  const financials = await loadFinancials(ticker);
  if (!financials.data) throw new FinancialDataUnavailableError(ticker);
  try {
    const risks = await loadRisks(ticker, financials.data);
    return { data: { ...financials.data, filingRisks: risks.data ?? [] }, freshness: { financials: financials.freshness, excerpts: risks.freshness } };
  } catch {
    return { data: { ...financials.data, filingRisks: [] }, freshness: { financials: financials.freshness, excerpts: { status: "unavailable" } } };
  }
}

export async function rebuildAnalysisFromComponentCaches(
  rawTicker: string,
  requested?: Partial<DcfAssumptions>,
  persistSnapshot = requested == null,
) {
  const ticker = normalizeTicker(rawTicker);
  const financials = await loadFinancials(ticker);
  if (!financials.data) throw new FinancialDataUnavailableError(ticker);
  const quoteRequest = loadQuote(ticker, financials.data);
  const [quote, estimates, risks, news, peers] = await Promise.all([
    quoteRequest,
    loadEstimates(ticker, financials.data),
    loadRisks(ticker, financials.data),
    loadNews(ticker, financials.data),
    quoteRequest.then((quote) => {
      if (!quote.data) throw new SourceDataUnavailableError(`A market quote is unavailable for ${ticker}.`);
      return loadPeers(ticker, financials.data, quote.data);
    }),
  ]);
  if (!quote.data) throw new SourceDataUnavailableError(`A market quote is unavailable for ${ticker}.`);
  if (!estimates.data) throw new SourceDataUnavailableError(`Analyst estimates are unavailable for ${ticker}.`);
  if (!risks.data) throw new SourceDataUnavailableError(`Risk disclosures are unavailable for ${ticker}.`);
  if (!news.data) throw new SourceDataUnavailableError(`News coverage is unavailable for ${ticker}.`);
  if (!peers.data) throw new SourceDataUnavailableError(`Comparable-company data is unavailable for ${ticker}.`);
  const financialsWithRisks = { ...financials.data, filingRisks: risks.data };
  const analysis = await buildAnalysis(ticker, requested, {
    allowUnavailableValuation: requested == null,
    financials: financialsWithRisks,
    financialSourceMode: financials.freshness.status === "live" ? "live-sec" : "normalized-cache",
    quote: quote.data,
    analystEstimates: estimates.data,
    peerSet: peers.data,
    newsFeed: news.data,
    warnings: financials.warnings,
  });
  const pageStatus = [financials.freshness, quote.freshness, estimates.freshness, peers.freshness, risks.freshness, news.freshness]
    .some((item) => item.status === "stale") ? "stale" : "live";
  const enriched = attachFreshness(analysis, pageStatus, {
    financials: financials.freshness,
    quote: quote.freshness,
    analystEstimates: estimates.freshness,
    comps: peers.freshness,
    news: news.freshness,
    risks: risks.freshness,
  });
  const complete = { ...enriched, data_scope: "full" as const, loaded_sections: ALL_ANALYSIS_SECTIONS };
  if (persistSnapshot) {
    const stored = await writeAnalysisSnapshot(complete);
    if (stored) await recordCompanyViewInBackground(ticker, stored.listingId);
  }
  return complete;
}

export async function refreshDueCompanies(limit = 3, excludeTicker?: string) {
  const due = await listDueRefreshTickers(limit, excludeTicker);
  for (const item of due) {
    const leaseKey = `scheduled-overview:${item.ticker}`;
    if (!await acquireCacheRefreshLease(leaseKey, 60_000)) continue;
    try {
      await rebuildOverviewFromComponentCaches(item.ticker);
      await markScheduledRefresh(item.listing_id, true);
    } catch {
      await markScheduledRefresh(item.listing_id, false);
    } finally {
      await releaseCacheRefreshLease(leaseKey);
    }
  }
  return due.length;
}

export async function warmPopularCompanies(seedSize = 100, batchSize = 2) {
  const popularTickers = await fetchPopularUniverseTickers(seedSize);
  const uncached = await listUncachedTickers(popularTickers, batchSize);
  let warmed = 0;
  for (const ticker of uncached) {
    const leaseKey = `overview:${ticker}`;
    if (!await acquireCacheRefreshLease(leaseKey, 60_000)) continue;
    try {
      await rebuildOverviewFromComponentCaches(ticker);
      warmed += 1;
    } catch {
      // Another scheduled pass can retry without blocking the rest of the batch.
    } finally {
      await releaseCacheRefreshLease(leaseKey);
    }
  }
  return warmed;
}
