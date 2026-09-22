import { calculatePegProjection } from "./peg.ts";
import { FinancialModelInputError, InvalidRequestError } from "./provider-errors.ts";
import type { Assumptions, ComparableCompany, Period } from "./analysis-types.ts";

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  forecast_years: 5,
  revenue_growth: null,
  fcf_margin: null,
  wacc: 0.09,
  terminal_growth: 0.025,
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const divide = (a?: number | null, b?: number | null) => (a == null || !b ? null : a / b);
const yoyGrowth = (current?: number, previous?: number) =>
  current != null && previous != null && previous > 0 ? current / previous - 1 : null;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const cagr = (start?: number, end?: number, years = 1) =>
  start && end && start > 0 && end > 0 ? (end / start) ** (1 / years) - 1 : null;

export function calculateMetrics(periods: Period[], price: number, quotedMarketCap?: number | null) {
  const latest = periods.at(-1)!.values;
  const prior = periods.at(-2)?.values ?? {};
  const series = (key: string) => periods.map((item) => item.values[key]).filter((value): value is number => value != null);
  const revenue = series("revenue");
  const income = series("net_income");
  const fcf = series("free_cash_flow");
  const margins = periods
    .map((item) => divide(item.values.operating_income, item.values.revenue))
    .filter((value): value is number => value != null);
  const averageMargin = margins.length
    ? margins.reduce((sum, value) => sum + value, 0) / margins.length
    : null;
  const marginVolatility = averageMargin == null
    ? null
    : Math.sqrt(margins.reduce((sum, value) => sum + (value - averageMargin) ** 2, 0) / margins.length);
  const shares = latest.shares_outstanding ?? latest.diluted_shares;
  const marketCap = quotedMarketCap && quotedMarketCap > 0 ? quotedMarketCap : shares ? shares * price : undefined;
  const debt = latest.total_debt ?? latest.long_term_debt ?? null;
  const liquidAssets = latest.cash_and_investments ?? latest.cash ?? null;
  const netDebt = latest.net_debt ?? (debt != null && liquidAssets != null ? debt - liquidAssets : null);
  const investedCapital = latest.equity != null && debt != null && liquidAssets != null
    ? latest.equity + debt - liquidAssets
    : null;
  const eps = divide(latest.net_income, latest.diluted_shares);
  const priorEps = divide(prior.net_income, prior.diluted_shares);
  const shareRatio = divide(latest.diluted_shares, prior.diluted_shares);
  return {
    revenue_growth_yoy: yoyGrowth(latest.revenue, prior.revenue),
    net_income_growth_yoy: yoyGrowth(latest.net_income, prior.net_income),
    eps_growth_yoy: yoyGrowth(eps ?? undefined, priorEps ?? undefined),
    fcf_growth_yoy: yoyGrowth(latest.free_cash_flow, prior.free_cash_flow),
    revenue_cagr: cagr(revenue[0], revenue.at(-1), Math.max(revenue.length - 1, 1)),
    net_income_cagr: cagr(income[0], income.at(-1), Math.max(income.length - 1, 1)),
    fcf_cagr: cagr(fcf[0], fcf.at(-1), Math.max(fcf.length - 1, 1)),
    gross_margin: divide(latest.gross_profit, latest.revenue),
    operating_margin: divide(latest.operating_income, latest.revenue),
    fcf_margin: divide(latest.free_cash_flow, latest.revenue),
    roic: latest.operating_income == null ? null : divide(latest.operating_income * 0.79, investedCapital),
    roe: divide(latest.net_income, latest.equity),
    net_debt: netDebt,
    net_debt_to_fcf: netDebt != null && latest.free_cash_flow != null && latest.free_cash_flow > 0
      ? divide(netDebt, latest.free_cash_flow)
      : null,
    fcf_conversion: latest.free_cash_flow != null && latest.free_cash_flow > 0
      && latest.net_income != null && latest.net_income > 0
      ? divide(latest.free_cash_flow, latest.net_income)
      : null,
    share_change: shareRatio == null ? null : shareRatio - 1,
    buyback_yield: divide(latest.share_repurchases, marketCap),
    market_cap: marketCap ?? null,
    pe: latest.net_income != null && latest.net_income > 0
      ? divide(marketCap, latest.net_income) ?? divide(price, eps ?? undefined)
      : null,
    price_to_book: latest.equity != null && latest.equity > 0 ? divide(marketCap, latest.equity) : null,
    price_to_fcf: latest.free_cash_flow != null && latest.free_cash_flow > 0
      ? divide(marketCap, latest.free_cash_flow)
      : null,
    fcf_yield: divide(latest.free_cash_flow, marketCap),
    operating_margin_volatility: marginVolatility,
    earnings_positive_years: income.filter((value) => value > 0).length,
    history_years: periods.length,
  };
}

function dcfValue(
  periods: Period[],
  growth: number,
  margin: number,
  wacc: number,
  terminalGrowth: number,
  years: number,
  shares: number,
  netDebt: number,
) {
  const latest = periods.at(-1)!.values;
  if (latest.revenue == null || latest.revenue <= 0) throw new FinancialModelInputError();
  let revenue = latest.revenue;
  let presentValue = 0;
  let projectedFcf = 0;
  for (let year = 1; year <= years; year += 1) {
    revenue *= 1 + growth;
    projectedFcf = revenue * margin;
    presentValue += projectedFcf / (1 + wacc) ** year;
  }
  const terminal = (projectedFcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  return Math.max((presentValue + terminal / (1 + wacc) ** years - netDebt) / shares, 0);
}

function reverseDcf(periods: Period[], price: number, margin: number, assumptions: Assumptions, shares: number, netDebt: number) {
  let low = -0.2;
  let high = 0.6;
  for (let index = 0; index < 70; index += 1) {
    const midpoint = (low + high) / 2;
    const value = dcfValue(
      periods,
      midpoint,
      margin,
      assumptions.wacc,
      assumptions.terminal_growth,
      assumptions.forecast_years,
      shares,
      netDebt,
    );
    if (value < price) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

export function calculateValuation(
  periods: Period[],
  metrics: ReturnType<typeof calculateMetrics>,
  price: number,
  assumptions: Assumptions,
  peers: ComparableCompany[],
  allowUnavailable = false,
) {
  if (assumptions.terminal_growth >= assumptions.wacc) {
    throw new InvalidRequestError("Terminal growth must be lower than WACC.");
  }
  const latest = periods.at(-1)!.values;
  const quoteImpliedShares = divide(metrics.market_cap ?? undefined, price);
  const reportedShares = latest.shares_outstanding ?? latest.diluted_shares;
  const shares = quoteImpliedShares != null && quoteImpliedShares > 0
    ? quoteImpliedShares
    : reportedShares != null && reportedShares > 0
      ? reportedShares
      : null;
  const historicalGrowth = assumptions.revenue_growth ?? metrics.revenue_cagr;
  const historicalMargin = assumptions.fcf_margin ?? metrics.fcf_margin;
  const netDebt = metrics.net_debt;
  if (shares == null || historicalGrowth == null || historicalMargin == null || netDebt == null || latest.revenue == null || latest.revenue <= 0) {
    if (!allowUnavailable) throw new FinancialModelInputError();
    const missing = [shares == null && "share count", historicalGrowth == null && "revenue growth", historicalMargin == null && "free-cash-flow margin", netDebt == null && "net debt", !(latest.revenue != null && latest.revenue > 0) && "positive revenue"].filter(Boolean);
    const reason = `Valuation unavailable: required reported inputs are missing (${missing.join(", ")}). No replacement values have been assumed.`;
    return {
      current_price: price, bear_value: null, base_value: null, bull_value: null, upside_to_fair_value: null,
      methods: { dcf: null, comparable_companies: null, growth_adjusted: null, normalized_multiple: null },
      earnings_multiple_status: "unavailable", assumptions,
      reverse_dcf: { implied_revenue_growth: null, interpretation: reason },
      growth_projection: {
        basis: "revenue" as const, forecast_years: 5 as const, projections: [],
        average_annual_growth: null, current_pe: metrics.pe, peg_ratio: null,
        target_peg: 1.2 as const, score: null, interpretation: reason,
      },
      methodology: reason,
    };
  }
  const growth = clamp(historicalGrowth, 0.02, 0.25);
  const margin = clamp(historicalMargin, 0.02, 0.45);
  const pureDcf = dcfValue(periods, growth, margin, assumptions.wacc, assumptions.terminal_growth, assumptions.forecast_years, shares, netDebt);
  const bear = dcfValue(periods, clamp(growth - 0.04, -0.1, 0.4), clamp(margin * 0.86, 0.01, 0.55), assumptions.wacc + 0.015, Math.max(assumptions.terminal_growth - 0.005, 0), assumptions.forecast_years, shares, netDebt);
  const bull = dcfValue(periods, clamp(growth + 0.04, -0.05, 0.45), clamp(margin * 1.1, 0.01, 0.58), Math.max(assumptions.wacc - 0.01, 0.05), Math.min(assumptions.terminal_growth + 0.005, 0.05), assumptions.forecast_years, shares, netDebt);
  const eps = divide(latest.net_income, shares);
  const hasPositiveEarnings = eps != null && eps > 0;
  const targetPe = metrics.roic == null ? null : clamp(18 + growth * 55 + metrics.roic * 18, 12, 42);
  const growthValue = hasPositiveEarnings && targetPe != null ? eps * targetPe : null;
  const peerMultiples = peers
    .map((peer) => peer.pe)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const comparable = hasPositiveEarnings && peerMultiples.length ? eps * median(peerMultiples) : null;
  const normalized = hasPositiveEarnings && targetPe != null ? eps * clamp(targetPe * 0.92, 12, 38) : null;
  const valuationMethods = [
    { label: "DCF", value: pureDcf, weight: 0.55 },
    { label: "peer P/E", value: comparable, weight: 0.2 },
    { label: "growth-adjusted P/E", value: growthValue, weight: 0.15 },
    { label: "normalized P/E", value: normalized, weight: 0.1 },
  ].filter((method): method is { label: string; value: number; weight: number } => method.value != null);
  const availableWeight = valuationMethods.reduce((sum, method) => sum + method.weight, 0);
  const fairValue = valuationMethods.reduce((sum, method) => sum + method.value * method.weight, 0) / availableWeight;
  const methodology = valuationMethods
    .map((method) => `${Math.round(method.weight / availableWeight * 10_000) / 100}% ${method.label}`)
    .join(", ");
  const impliedGrowth = reverseDcf(periods, price, margin, assumptions, shares, netDebt);
  const growthProjection = calculatePegProjection(periods, metrics.pe, growth);
  return {
    current_price: price,
    bear_value: bear,
    base_value: fairValue,
    bull_value: Math.max(bull, fairValue),
    upside_to_fair_value: fairValue / price - 1,
    methods: { dcf: pureDcf, comparable_companies: comparable, growth_adjusted: growthValue, normalized_multiple: normalized },
    earnings_multiple_status: hasPositiveEarnings
      ? "available"
      : "not meaningful while trailing earnings are zero or negative",
    assumptions: { ...assumptions, revenue_growth: growth, fcf_margin: margin },
    reverse_dcf: {
      implied_revenue_growth: impliedGrowth,
      interpretation: `The market price implies approximately ${(impliedGrowth * 100).toFixed(1)}% annual revenue growth over the explicit forecast period.`,
    },
    growth_projection: growthProjection,
    methodology: hasPositiveEarnings
      ? methodology
      : "100% DCF. P/E-based methods are not meaningful while trailing earnings are zero or negative.",
  };
}

const scaled = (value: number | null, poor: number, excellent: number) =>
  value == null ? null : clamp(((value - poor) / (excellent - poor)) * 100, 0, 100);

function availableScore(parts: Array<{ value: number | null; weight: number }>) {
  const available = parts.filter((part): part is { value: number; weight: number } => part.value != null);
  const weight = available.reduce((sum, part) => sum + part.weight, 0);
  return weight ? Math.round(available.reduce((sum, part) => sum + part.value * part.weight, 0) / weight) : null;
}

export function calculateScore(
  metrics: ReturnType<typeof calculateMetrics>,
  valuation: ReturnType<typeof calculateValuation>,
) {
  const debtRatio = metrics.net_debt_to_fcf;
  const debtScore = debtRatio != null && debtRatio < 0 ? 90 : scaled(debtRatio, 4, 0);
  const positiveRatio = metrics.earnings_positive_years / Math.max(metrics.history_years, 1);
  const candidateCategories = {
    valuation: valuation.growth_projection.score,
    quality: availableScore([{ value: scaled(metrics.roic, 0.05, 0.3), weight: 0.45 }, { value: scaled(metrics.operating_margin, 0.05, 0.35), weight: 0.3 }, { value: scaled(metrics.fcf_conversion, 0.55, 1.1), weight: 0.25 }]),
    growth: availableScore([{ value: scaled(metrics.revenue_cagr, 0, 0.2), weight: 0.45 }, { value: scaled(metrics.net_income_cagr, -0.03, 0.25), weight: 0.3 }, { value: scaled(metrics.fcf_cagr, -0.03, 0.25), weight: 0.25 }]),
    financial_strength: availableScore([{ value: debtScore, weight: 0.65 }, { value: scaled(metrics.fcf_conversion, 0.5, 1.1), weight: 0.35 }]),
    capital_allocation: availableScore([{ value: metrics.share_change == null ? null : scaled(-metrics.share_change, -0.03, 0.04), weight: 0.55 }, { value: scaled(metrics.buyback_yield, 0, 0.05), weight: 0.45 }]),
    earnings_quality: availableScore([{ value: positiveRatio * 100, weight: 0.55 }, { value: scaled(metrics.operating_margin_volatility, 0.08, 0), weight: 0.45 }]),
    momentum: availableScore([{ value: scaled(metrics.revenue_growth_yoy, -0.1, 0.25), weight: 0.5 }, { value: scaled(metrics.fcf_growth_yoy, -0.25, 0.35), weight: 0.5 }]),
    risk: availableScore([{ value: scaled(metrics.operating_margin_volatility, 0.1, 0), weight: 0.5 }, { value: debtScore, weight: 0.35 }, { value: positiveRatio * 100, weight: 0.15 }]),
  };
  const baseWeights: Record<string, number> = { valuation: 0.3, quality: 0.2, growth: 0.15, financial_strength: 0.1, capital_allocation: 0.1, earnings_quality: 0.05, momentum: 0.05, risk: 0.05 };
  const categories = Object.fromEntries(Object.entries(candidateCategories).filter((entry): entry is [string, number] => entry[1] != null));
  const availableCategoryWeight = Object.keys(categories).reduce((sum, key) => sum + baseWeights[key], 0);
  if (!availableCategoryWeight) throw new FinancialModelInputError();
  const weights = Object.fromEntries(Object.keys(categories).map((key) => [key, baseWeights[key] / availableCategoryWeight]));
  const overall = Math.round(Object.entries(categories).reduce((sum, [key, value]) => sum + value * weights[key], 0));
  const rating = overall >= 85 ? "Highly Attractive" : overall >= 70 ? "Attractive" : overall >= 50 ? "Neutral" : "Unattractive";
  return {
    overall,
    rating,
    categories,
    weights,
    formula: Object.keys(categories).length === Object.keys(baseWeights).length
      ? "Weighted arithmetic mean of eight category scores; valuation is the five-year forward PEG score"
      : "Weighted arithmetic mean of available category scores; unavailable inputs and categories are omitted and remaining weights are renormalized",
  };
}

export function calculateBuyTarget(
  metrics: ReturnType<typeof calculateMetrics>,
  valuation: ReturnType<typeof calculateValuation>,
  score: ReturnType<typeof calculateScore>,
) {
  const components: Record<string, number> = {
    base: 0.1,
  };
  if (metrics.operating_margin_volatility != null) components.earnings_and_margin_volatility = clamp(metrics.operating_margin_volatility * 0.8, 0, 0.08);
  if (metrics.net_debt_to_fcf != null) components.balance_sheet_risk = clamp(Math.max(metrics.net_debt_to_fcf, 0) * 0.015, 0, 0.07);
  if (metrics.revenue_growth_yoy != null && metrics.revenue_cagr != null) components.growth_uncertainty = clamp(Math.abs(metrics.revenue_growth_yoy - metrics.revenue_cagr) * 0.2, 0, 0.05);
  if (score.categories.risk != null) components.low_risk_credit = -clamp((score.categories.risk - 70) / 1000, 0, 0.03);
  const marginOfSafety = clamp(Object.values(components).reduce((sum, value) => sum + value, 0), 0.08, 0.35);
  return {
    fair_value: valuation.base_value,
    margin_of_safety: marginOfSafety,
    buy_target: valuation.base_value == null ? null : valuation.base_value * (1 - marginOfSafety),
    current_price_gap: valuation.base_value == null ? null : (valuation.base_value * (1 - marginOfSafety)) / valuation.current_price - 1,
    components,
    methodology: valuation.base_value == null ? valuation.methodology : Object.keys(components).length === 5
      ? "Dynamic 8% to 35% margin of safety based on stability, debt, uncertainty and risk score"
      : "Dynamic 8% to 35% margin of safety based only on available stability, debt, growth and risk inputs",
  };
}
