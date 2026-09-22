import { normalizeTicker } from "./security-master.ts";
import {
  DEFAULT_ASSUMPTIONS,
  calculateBuyTarget,
  calculateMetrics,
  calculateScore,
  calculateValuation,
} from "./financial-model.ts";
import {
  NORMALIZATION_VERSION,
  SCORE_MODEL_VERSION,
  VALUATION_MODEL_VERSION,
} from "./model-versions.ts";
import {
  fetchAnalystEstimates,
  fetchQuote,
} from "./nasdaq-provider.ts";
import { fetchFinancialSource } from "./sec-provider.ts";
import { fetchComparableCompanies } from "./peer-data.ts";
import type {
  AnalysisSources,
  Assumptions,
} from "./analysis-types.ts";

export {
  compactNasdaqStockUniverse,
  fetchAnalystEstimates,
  fetchPopularUniverseTickers,
  fetchQuote,
} from "./nasdaq-provider.ts";
export {
  fetchCompanyRisks,
  fetchFinancialFingerprint,
  fetchFinancialSource,
  fetchPeerFilingContext,
} from "./sec-provider.ts";
export { fetchComparableCompanies } from "./peer-data.ts";

export type {
  AnalysisSources,
  AnalystEstimates,
  Assumptions,
  CompanyProfile,
  CompanyRisk,
  ComparableCompany,
  ComparableCompanyDataLoader,
  Filing,
  FinancialFingerprint,
  FinancialSource,
  PeerSet,
  Quote,
} from "./analysis-types.ts";

export async function buildAnalysis(
  rawTicker: string,
  requested?: Partial<Assumptions>,
  sources: AnalysisSources = {},
) {
  const ticker = normalizeTicker(rawTicker);
  const warnings: string[] = [...(sources.warnings ?? [])];
  const financials = sources.financials ?? await fetchFinancialSource(ticker);
  const sourceMode = sources.financialSourceMode ?? "live-sec";
  const quote = sources.quote ?? await fetchQuote(ticker);
  const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...requested };
  const metrics = calculateMetrics(financials.periods, quote.price, quote.market_cap);
  const peerSet = sources.peerSet ?? await fetchComparableCompanies(
    ticker,
    financials.profile,
    metrics.market_cap,
    financials.filings,
  );
  const peers = peerSet.companies;
  const valuation = calculateValuation(financials.periods, metrics, quote.price, assumptions, peers, sources.allowUnavailableValuation === true && requested == null);
  if (valuation.base_value == null) warnings.push(valuation.methodology);
  const score = calculateScore(metrics, valuation);
  const buyTarget = calculateBuyTarget(metrics, valuation, score);
  const analystEstimates = sources.analystEstimates ?? await fetchAnalystEstimates(ticker);
  const latest = financials.periods.at(-1)!.values;
  const newsFeed = sources.newsFeed ?? {
    items: [],
    fetched_at: new Date().toISOString(),
    providers: [],
    industry_query: null,
    warnings: [],
  };
  const risks = [...financials.filingRisks];
  return {
    company: { ticker, ...financials.profile },
    quote,
    headline: {
      score: score.overall,
      rating: score.rating,
      current_price: quote.price,
      fair_value: valuation.base_value,
      buy_target: buyTarget.buy_target,
      bear_value: valuation.bear_value,
      base_value: valuation.base_value,
      bull_value: valuation.bull_value,
      upside: valuation.upside_to_fair_value,
    },
    financials: financials.periods,
    quarterly_financials: financials.quarterlyPeriods,
    analyst_estimates: analystEstimates,
    latest,
    metrics,
    valuation,
    buy_target: buyTarget,
    score,
    comps: peers,
    peer_selection: {
      methodology: peerSet.methodology,
      source_provider: peerSet.source_provider,
      source_url: peerSet.source_url,
      source_as_of: peerSet.source_as_of,
      candidates_considered: peerSet.candidates_considered,
      selection_version: peerSet.selection_version,
    },
    filings: financials.filings,
    risks,
    news: newsFeed,
    provenance: {
      financials: sourceMode,
      quarterly_financials: financials.quarterlyPeriods.length
        ? "SEC 10-Q facts normalized to stand-alone fiscal quarters"
        : "Quarterly SEC facts unavailable",
      analyst_estimates: analystEstimates.quarterly.length || analystEstimates.annual.length
        ? analystEstimates.provider
        : "Analyst estimates unavailable",
      quote: quote.provider,
      risk_factors: financials.filingRisks.length ? "latest annual filing" : "Risk disclosures unavailable",
      news: newsFeed.providers.length ? newsFeed.providers.join(", ") : "News not loaded",
      comparables: peerSet.methodology,
      peer_snapshot_as_of: peers.length ? peers.map((peer) => peer.quote_as_of).join(" | ") : "Unavailable",
      methodology_version: "0.3.0-sites",
      normalization_version: NORMALIZATION_VERSION,
      valuation_model_version: VALUATION_MODEL_VERSION,
      score_model_version: SCORE_MODEL_VERSION,
      generated_at: new Date().toISOString(),
      warnings,
    },
  };
}
