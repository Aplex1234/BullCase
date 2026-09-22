import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import { compactShares } from "../../frontend/lib/format.ts";
import { projectMultipleValuation } from "../../frontend/lib/multiple-valuation.ts";
import { normalizeCompanyFacts } from "../lib/server/sec-normalizer.ts";
import { readHotAnalysisCache, writeHotAnalysisCache } from "../lib/server/analysis-cache.ts";
import { buildAnalysis } from "../lib/server/analysis.ts";
import { calculateMetrics } from "../lib/server/financial-model.ts";

test("missing debt or cash-flow inputs do not discard usable company research", async () => {
  for (const missingFields of [["total_debt", "long_term_debt", "net_debt"], ["free_cash_flow", "capex"]]) {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/financial-baseline/inputs/AAPL.json", import.meta.url), "utf8"));
    const latest = fixture.sources.financials.periods.at(-1).values;
    for (const field of missingFields) delete latest[field];
    const analysis = await buildAnalysis(fixture.ticker, undefined, { ...fixture.sources, allowUnavailableValuation: true });
    await assert.rejects(() => buildAnalysis(fixture.ticker, {}, { ...fixture.sources, allowUnavailableValuation: true }), { code: "financial_data_unavailable" });
    assert.equal(analysis.company.ticker, fixture.ticker);
    assert.equal(analysis.latest.revenue, latest.revenue);
    assert.equal(analysis.headline.fair_value, null);
    assert.equal(analysis.buy_target.buy_target, null);
    assert.equal(analysis.buy_target.current_price_gap, null);
    assert.equal(analysis.valuation.reverse_dcf.implied_revenue_growth, null);
    assert.ok(Object.values(analysis.valuation.methods).every((value) => value === null));
    assert.match(analysis.valuation.methodology, /Valuation unavailable/);
    assert.ok(analysis.provenance.warnings.some((warning) => /Valuation unavailable/.test(warning)));
    assert.deepEqual(analysis.comps, fixture.sources.peerSet.companies);
  }
});

const TERMINAL_SOURCE_FILES = [
  "../../frontend/components/ResearchTerminal.tsx",
  "../../frontend/components/ResearchPages.tsx",
  "../../frontend/components/CompanyHeader.tsx",
  "../../frontend/components/CompanySearch.tsx",
  "../../frontend/components/TerminalHeader.tsx",
  "../../frontend/components/TerminalNavigation.tsx",
  "../../frontend/hooks/useCompanyAnalysis.ts",
  "../../frontend/hooks/useSecuritySearch.ts",
  "../../frontend/hooks/useTerminalTheme.ts",
];

async function readTerminalSources() {
  return (await Promise.all(TERMINAL_SOURCE_FILES.map((file) => (
    readFile(new URL(file, import.meta.url), "utf8")
  )))).join("\n");
}

test("keeps the initial terminal and stylesheet within performance budgets", async () => {
  const chunkDirectory = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  const cssDirectory = new URL("../dist/client/_next/static/css/", import.meta.url);
  const chunks = await readdir(chunkDirectory);
  const stylesheets = await readdir(cssDirectory);
  const terminalChunk = chunks.find((file) => file.startsWith("ResearchTerminal-") && file.endsWith(".js"));
  assert.ok(terminalChunk, "ResearchTerminal chunk was not emitted");
  const terminalSize = (await stat(new URL(terminalChunk, chunkDirectory))).size;
  const cssSizes = await Promise.all(stylesheets.filter((file) => file.endsWith(".css")).map(async (file) => (await stat(new URL(file, cssDirectory))).size));
  assert.ok(terminalSize < 100 * 1024, `ResearchTerminal exceeded 100 KB: ${terminalSize}`);
  assert.ok(Math.max(...cssSizes) < 250 * 1024, `Stylesheet exceeded 250 KB: ${Math.max(...cssSizes)}`);
  const terminalSource = await readTerminalSources();
  const newsSource = await readFile(new URL("../../frontend/components/NewsView.tsx", import.meta.url), "utf8");
  const valuationSource = await readFile(new URL("../../frontend/components/MultipleValuationView.tsx", import.meta.url), "utf8");
  const carbonStyles = await readFile(new URL("../app/carbon.scss", import.meta.url), "utf8");
  assert.doesNotMatch(`${terminalSource}\n${newsSource}\n${valuationSource}`, /from "@carbon\/icons-react"/);
  assert.doesNotMatch(carbonStyles, /@use "@carbon\/styles\/scss\/components\/notification";/);
});

test("serves repeat analysis reads from a bounded short-lived hot cache", () => {
  const now = Date.parse("2026-08-30T00:00:00.000Z");
  const cached = {
    analysis: { company: { ticker: "PERF" }, financials: [] },
    listingId: "listing:NASDAQ:PERF",
    generatedAt: "2026-08-30T00:00:00.000Z",
    freshUntil: "2026-08-30T00:05:00.000Z",
    isFresh: true,
  };
  writeHotAnalysisCache("perf", cached, now);
  assert.equal(readHotAnalysisCache("PERF", now + 1)?.listingId, cached.listingId);
  assert.equal(readHotAnalysisCache("PERF", now + 30_001), null);
});

test("keeps valuation outputs per-share when SEC share counts are unavailable", async () => {
  const makePeriod = (fiscalYear, values) => ({
    fiscal_year: fiscalYear,
    period_type: "FY",
    period_end: `${fiscalYear}-12-31`,
    filed_at: `${fiscalYear + 1}-02-28`,
    accession_number: `brk-${fiscalYear}`,
    form: "10-K",
    currency: "USD",
    values,
    provenance: {},
  });
  const price = 500;
  const marketCap = 1_000_000_000_000;
  const analysis = await buildAnalysis("BRK-B", undefined, {
    financials: {
      profile: {
        cik: "0001067983",
        name: "Berkshire Hathaway Inc.",
        sector: "Financials",
        industry: "Multi-Sector Holdings",
        exchange: "NYSE",
        description: "Berkshire owns a diversified group of operating businesses.",
        description_source: "Test fixture",
        description_source_url: "https://www.sec.gov/edgar/browse/?CIK=1067983&owner=exclude",
      },
      periods: [
        makePeriod(2024, {
          revenue: 360_000_000_000,
          gross_profit: 90_000_000_000,
          operating_income: 45_000_000_000,
          net_income: 60_000_000_000,
          operating_cash_flow: 48_000_000_000,
          capex: 8_000_000_000,
          free_cash_flow: 40_000_000_000,
          cash: 160_000_000_000,
          long_term_debt: 120_000_000_000,
          equity: 560_000_000_000,
        }),
        makePeriod(2025, {
          revenue: 380_000_000_000,
          gross_profit: 96_000_000_000,
          operating_income: 50_000_000_000,
          net_income: 67_000_000_000,
          operating_cash_flow: 53_000_000_000,
          capex: 9_000_000_000,
          free_cash_flow: 44_000_000_000,
          cash: 180_000_000_000,
          long_term_debt: 125_000_000_000,
          equity: 620_000_000_000,
        }),
      ],
      quarterlyPeriods: [],
      filings: [],
      filingRisks: [],
    },
    quote: {
      price,
      market_cap: marketCap,
      as_of: "2026-08-13T00:00:00.000Z",
      currency: "USD",
      provider: "Test quote",
      source_url: null,
      is_delayed: true,
    },
    peerSet: {
      companies: [],
      methodology: "Test fixture",
      source_provider: "Test fixture",
      source_url: "https://example.com/peers",
      source_as_of: "2026-08-13T00:00:00.000Z",
      candidates_considered: 0,
      selection_version: "test",
    },
    analystEstimates: {
      quarterly: [],
      annual: [],
      provider: "Test fixture",
      as_of: null,
      source_url: "https://example.com/estimates",
      disclosure: "Test fixture",
    },
  });

  assert.equal(analysis.financials.at(-1).values.diluted_shares, undefined);
  assert.equal(analysis.financials.at(-1).values.shares_outstanding, undefined);
  assert.ok(analysis.valuation.methods.dcf > 0);
  assert.ok(analysis.valuation.methods.dcf < 100_000, "DCF must be a per-share value, not total equity value");
  assert.equal(analysis.valuation.methods.comparable_companies, null, "an empty peer set must not be replaced with a modeled peer multiple");
  assert.doesNotMatch(analysis.valuation.methodology, /peer P\/E/i);
  assert.ok(analysis.headline.fair_value < 100_000, "headline fair value must remain in per-share units");
});

test("keeps missing balance-sheet and margin-history inputs unavailable", () => {
  const periods = [2023, 2024, 2025].map((fiscalYear) => ({
    fiscal_year: fiscalYear,
    period_type: "FY",
    period_end: `${fiscalYear}-12-31`,
    filed_at: `${fiscalYear + 1}-02-28`,
    accession_number: `missing-${fiscalYear}`,
    form: "10-K",
    currency: "USD",
    values: {
      revenue: 10_000_000_000 + (fiscalYear - 2023) * 500_000_000,
      net_income: 1_000_000_000,
      free_cash_flow: 900_000_000,
      diluted_shares: 1_000_000_000,
      shares_outstanding: 1_000_000_000,
    },
    provenance: {},
  }));

  const metrics = calculateMetrics(periods, 20, 20_000_000_000);
  assert.equal(metrics.net_debt, null, "missing debt and liquidity facts must not imply zero net debt");
  assert.equal(metrics.net_debt_to_fcf, null, "missing balance-sheet facts must not imply debt-free leverage");
  assert.equal(metrics.operating_margin_volatility, null, "missing margin history must not imply perfect stability");
});

test("does not present negative earnings multiples or fair values for a loss-making company", async () => {
  const makePeriod = (fiscalYear, netIncome, freeCashFlow) => ({
    fiscal_year: fiscalYear,
    period_type: "FY",
    period_end: `${fiscalYear}-12-31`,
    filed_at: `${fiscalYear + 1}-02-28`,
    accession_number: `loss-${fiscalYear}`,
    form: "10-K",
    currency: "USD",
    values: {
      revenue: 5_000_000_000,
      operating_income: netIncome,
      net_income: netIncome,
      operating_cash_flow: freeCashFlow,
      capex: 0,
      free_cash_flow: freeCashFlow,
      cash: 3_000_000_000,
      total_debt: 1_000_000_000,
      equity: 4_000_000_000,
      diluted_shares: 1_000_000_000,
      shares_outstanding: 1_000_000_000,
    },
    provenance: {},
  });
  const analysis = await buildAnalysis("LOSS", undefined, {
    financials: {
      profile: {
        cik: "0000000002",
        name: "Loss Company",
        sector: "Industrials",
        industry: "Manufacturing",
        exchange: "NASDAQ",
        description: "Loss Company manufactures products.",
        description_source: "Test fixture",
        description_source_url: "https://www.sec.gov/",
      },
      periods: [makePeriod(2024, -1_000_000_000, -200_000_000), makePeriod(2025, -800_000_000, -100_000_000)],
      quarterlyPeriods: [],
      filings: [],
      filingRisks: [],
    },
    quote: {
      price: 10,
      market_cap: 10_000_000_000,
      as_of: "2026-08-13T00:00:00.000Z",
      currency: "USD",
      provider: "Test quote",
      source_url: null,
      is_delayed: true,
    },
    peerSet: {
      companies: [], methodology: "Test", source_provider: "Test", source_url: "https://example.com",
      source_as_of: "2026-08-13T00:00:00.000Z", candidates_considered: 0, selection_version: "test",
    },
    analystEstimates: {
      quarterly: [], annual: [], provider: "Test", as_of: null, source_url: "https://example.com", disclosure: "Test",
    },
  });

  assert.equal(analysis.valuation.methods.comparable_companies, null);
  assert.equal(analysis.valuation.methods.growth_adjusted, null);
  assert.equal(analysis.valuation.methods.normalized_multiple, null);
  assert.equal(analysis.metrics.fcf_conversion, null, "two negative values must not become a positive conversion ratio");
  assert.equal(analysis.metrics.net_debt_to_fcf, null, "leverage-to-FCF is not meaningful while FCF is negative");
  assert.ok(analysis.headline.fair_value >= 0);
  assert.ok(analysis.headline.bear_value >= 0);
  assert.ok(analysis.headline.bull_value >= 0);

  const multiple = projectMultipleValuation({
    basis: "net_income",
    forecastYears: 5,
    currentNetIncome: -800_000_000,
    currentEps: -0.8,
    currentShares: 1_000_000_000,
    currentPrice: 10,
    currentMarketCap: 10_000_000_000,
    annualShareChange: 0,
    scenario: { growthRate: 0.15, exitPe: 20 },
  });
  assert.equal(multiple.projectedMarketCap, null);
  assert.equal(multiple.projectedSharePrice, null);
  assert.equal(multiple.valuationLabel, "Unavailable");
});

test("formats share counts as shares rather than currency", () => {
  assert.equal(compactShares(14_700_000_000), "14.7B shares");
  assert.equal(compactShares(null), "N/A");
});

test("adjusts historical shares and EPS across stock splits", () => {
  const annual = (year, income, shares, filed) => ({
    start: `${year}-01-01`, end: `${year}-12-31`, val: income, accn: `${year}-annual`, fy: year, fp: "FY", form: "10-K", filed,
  });
  const share = (year, shares, filed) => ({
    start: `${year}-01-01`, end: `${year}-12-31`, val: shares, accn: `${year}-annual`, fy: year, fp: "FY", form: "10-K", filed,
  });
  const payload = {
    cik: 1,
    facts: { "us-gaap": {
      NetIncomeLoss: { units: { USD: [annual(2022, 100, 100, "2023-02-01"), annual(2023, 120, 120, "2024-02-01"), annual(2024, 132, 132, "2025-02-01")] } },
      WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [share(2022, 100, "2023-02-01"), share(2023, 120, "2024-02-01"), share(2024, 240, "2025-02-01")] } },
      StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [{ end: "2024-06-01", val: 2, accn: "split", fy: 2024, fp: "Q2", form: "10-Q", filed: "2024-08-01" }] } },
    } },
  };

  const periods = normalizeCompanyFacts(payload);
  assert.deepEqual(periods.map((period) => period.values.diluted_shares), [200, 240, 240]);
  assert.deepEqual(periods.map((period) => period.values.diluted_eps), [0.5, 0.5, 0.55]);
  assert.match(periods[0].provenance.diluted_shares.formula, /split-adjusted/i);
});
