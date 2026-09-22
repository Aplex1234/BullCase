import assert from "node:assert/strict";
import test from "node:test";

import { buildFinancialChartData } from "../../frontend/lib/chart.ts";
import { buildFinancialExplorerData, FINANCIAL_GROUPS, formatScaledMoney, getFinancialScale } from "../../frontend/lib/financials.ts";
import { calculatePegProjection } from "../lib/server/peg.ts";
import { fetchAnalystEstimates } from "../lib/server/nasdaq-provider.ts";
import { extractRiskFactorThemes } from "../lib/server/risk-factors.ts";
import { buildAnalysis } from "../lib/server/analysis.ts";
import { normalizeCompanyFacts } from "../lib/server/sec-normalizer.ts";


test("rebuilds valuation and score from supplied normalized inputs with external access disabled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("External access disabled for cache rebuild test"); };
  const makePeriod = (year, revenue, income, cashFlow) => ({
    fiscal_year: year,
    period_type: "FY",
    period_end: `${year}-12-31`,
    filed_at: `${year + 1}-02-01`,
    accession_number: `${year}-cache-test`,
    form: "10-K",
    currency: "USD",
    values: {
      revenue,
      operating_income: income * 1.2,
      net_income: income,
      operating_cash_flow: cashFlow,
      capex: cashFlow * 0.2,
      free_cash_flow: cashFlow * 0.8,
      cash: 20_000_000_000,
      total_debt: 5_000_000_000,
      equity: 40_000_000_000,
      diluted_shares: 1_000_000_000,
      shares_outstanding: 1_000_000_000,
    },
    provenance: {},
  });
  const financials = {
    profile: {
      cik: "0000000001",
      name: "Cached Company",
      sector: "Technology",
      industry: "Software",
      exchange: "NASDAQ",
      description: "Cached Company develops business software.",
      description_source: "Cached normalized source",
      description_source_url: "https://www.sec.gov/",
    },
    periods: [
      makePeriod(2023, 100_000_000_000, 20_000_000_000, 25_000_000_000),
      makePeriod(2024, 110_000_000_000, 23_000_000_000, 28_000_000_000),
      makePeriod(2025, 121_000_000_000, 26_000_000_000, 31_000_000_000),
    ],
    quarterlyPeriods: [],
    filings: [],
    filingRisks: [],
  };

  try {
    const analysis = await buildAnalysis("CACH", undefined, {
      financials,
      financialSourceMode: "normalized-cache",
      quote: {
        price: 120,
        market_cap: 120_000_000_000,
        as_of: "2026-08-09T12:00:00.000Z",
        currency: "USD",
        provider: "Cached quote",
        source_url: null,
        is_delayed: true,
      },
      analystEstimates: {
        quarterly: [],
        annual: [],
        provider: "Cached estimates",
        as_of: "2026-08-09T00:00:00.000Z",
        source_url: "https://www.nasdaq.com/",
        disclosure: "Cached test data.",
      },
      peerSet: {
        companies: [],
        methodology: "Cached peer set",
        source_provider: "Cached source",
        source_url: "https://www.nasdaq.com/market-activity/stocks/screener",
        source_as_of: "2026-08-09T00:00:00.000Z",
        candidates_considered: 0,
        selection_version: "peer-selection-test",
      },
    });
    assert.equal(analysis.company.name, "Cached Company");
    assert.equal(analysis.provenance.financials, "normalized-cache");
    assert.equal(analysis.financials.length, 3);
    assert.ok(Number.isFinite(analysis.headline.fair_value));
    assert.ok(Number.isFinite(analysis.score.overall));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("financial chart scales operating income to readable billions", () => {
  const [point] = buildFinancialChartData([{
    fiscal_year: 2025,
    period_type: "FY",
    period_end: null,
    filed_at: null,
    accession_number: null,
    form: "10-K",
    currency: "USD",
    values: {
      operating_income: 14_008_000_000,
      free_cash_flow: 11_600_000_000,
    },
    provenance: {},
  }]);

  assert.equal(point.operatingIncome, 14.008);
  assert.equal(formatScaledMoney(point.operatingIncome, "B"), "$14.0B");
  assert.equal(formatScaledMoney(point.freeCashFlow, "B"), "$11.6B");
});

test("financial chart and explorer dynamically scale to millions for smaller companies like POCI", () => {
  const pociPeriods = [
    {
      fiscal_year: 2024,
      period_type: "FY",
      period_end: "2024-12-31",
      filed_at: "2025-03-01",
      accession_number: "poci-2024",
      form: "10-K",
      currency: "USD",
      values: {
        revenue: 22_500_000,
        gross_profit: 10_200_000,
        operating_income: -2_800_000,
        net_income: -3_100_000,
      },
      provenance: {},
    },
    {
      fiscal_year: 2025,
      period_type: "FY",
      period_end: "2025-12-31",
      filed_at: "2026-03-01",
      accession_number: "poci-2025",
      form: "10-K",
      currency: "USD",
      values: {
        revenue: 24_800_000,
        gross_profit: 12_100_000,
        operating_income: -3_200_000,
        net_income: -3_500_000,
      },
      provenance: {},
    },
  ];

  const incomeGroup = FINANCIAL_GROUPS.find((g) => g.key === "income");
  assert.ok(incomeGroup);

  const scale = getFinancialScale(pociPeriods, incomeGroup);
  assert.equal(scale.factor, 1_000_000);
  assert.equal(scale.unit, "M");
  assert.equal(scale.label, "in millions");

  const explorerData = buildFinancialExplorerData(pociPeriods, incomeGroup, scale.factor);
  assert.equal(explorerData[1].revenue, 24.8);
  assert.equal(explorerData[1].gross_profit, 12.1);
  assert.equal(explorerData[1].operating_income, -3.2);
  assert.equal(explorerData[1].net_income, -3.5);

  // Formats correctly with M unit and no negative zero
  assert.equal(formatScaledMoney(explorerData[1].revenue, scale.unit), "$24.8M");
  assert.equal(formatScaledMoney(explorerData[1].gross_profit, scale.unit), "$12.1M");
  assert.equal(formatScaledMoney(explorerData[1].operating_income, scale.unit), "-$3.2M");
  assert.equal(formatScaledMoney(explorerData[1].net_income, scale.unit), "-$3.5M");
  assert.equal(formatScaledMoney(0, scale.unit), "$0.0M");
  assert.equal(formatScaledMoney(-0.000001, scale.unit), "$0.0M");

  // Overview chart scaling
  const chartData = buildFinancialChartData(pociPeriods, scale.factor);
  assert.equal(chartData[1].revenue, 24.8);
  assert.equal(chartData[1].operatingIncome, -3.2);
});

test("calculates the five-year PEG score using growth percentage points", () => {
  const periods = [{ fiscal_year: 2025, values: { revenue: 100_000_000_000, net_income: 20_000_000_000 } }];
  const attractive = calculatePegProjection(periods, 20, 0.2);
  assert.equal(attractive.projections.length, 5);
  assert.equal(attractive.average_annual_growth, 0.2);
  assert.equal(attractive.peg_ratio, 1);
  assert.equal(attractive.score, 100);
  assert.equal(attractive.projections.at(-1).fiscal_year, 2030);

  const target = calculatePegProjection(periods, 24, 0.2);
  assert.ok(Math.abs(target.peg_ratio - 1.2) < 1e-9);
  assert.equal(target.score, 100);

  const expensive = calculatePegProjection(periods, 36, 0.2);
  assert.ok(Math.abs(expensive.peg_ratio - 1.8) < 1e-9);
  assert.equal(expensive.score, 67);

  const unavailable = calculatePegProjection(periods, null, 0.2);
  assert.equal(unavailable.peg_ratio, null);
  assert.equal(unavailable.score, null);
});

test("keeps missing analyst estimate fields unavailable instead of converting them to zero", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      quarterlyForecast: {
        asOf: "2026-09-01",
        rows: [{
          fiscalEnd: "Dec 2026",
          consensusEPSForecast: null,
          highEPSForecast: "",
          lowEPSForecast: "1.25",
          noOfEstimates: null,
          up: "",
          down: 2,
        }],
      },
    },
  }), { headers: { "content-type": "application/json" } });

  try {
    const estimates = await fetchAnalystEstimates("MISS");
    assert.equal(estimates.quarterly[0].consensus_eps, null);
    assert.equal(estimates.quarterly[0].high_eps, null);
    assert.equal(estimates.quarterly[0].analyst_count, null);
    assert.equal(estimates.quarterly[0].revisions_up, null);
    assert.equal(estimates.quarterly[0].low_eps, 1.25);
    assert.equal(estimates.quarterly[0].revisions_down, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ignores SEC facts with missing values instead of inventing zero revenue", () => {
  const annualRevenue = (year, value) => ({
    form: "10-K",
    fy: year,
    fp: "FY",
    filed: `${year + 1}-02-01`,
    val: value,
    accn: `${year}-missing-value-test`,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  });
  const payload = {
    cik: 1,
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              annualRevenue(2023, 100_000_000),
              annualRevenue(2024, 110_000_000),
              annualRevenue(2025, 120_000_000),
              annualRevenue(2026, null),
            ],
          },
        },
      },
    },
  };

  const periods = normalizeCompanyFacts(payload);
  assert.deepEqual(periods.map((period) => period.fiscal_year), [2023, 2024, 2025]);
  assert.equal(periods.at(-1).values.revenue, 120_000_000);
});

test("extracts company-reported risks from an annual filing section", () => {
  const html = `
    <h2>Item 1A. Risk Factors</h2>
    <p>Cybersecurity incidents and failures of our systems could disrupt our operations and harm our business.</p>
    <p>Changes in laws and regulation may increase our compliance costs or limit the services that we offer.</p>
    <p>Intense competition could reduce our market share, revenue growth and operating results.</p>
    <p>We depend on third-party networks, and outages or service failures may adversely affect customers.</p>
    <h2>Item 1B. Unresolved Staff Comments</h2>
    <p>None.</p>
  `;
  const themes = extractRiskFactorThemes(html, "10-K", 8);
  assert.ok(themes.some((theme) => theme.key === "cybersecurity-data-privacy"));
  assert.ok(themes.flatMap((theme) => theme.evidence).every((evidence) => !evidence.includes("Unresolved Staff Comments")));
  assert.ok(themes.some((theme) => theme.summary.includes("the company depends on third-party networks")));
});

test("extracts Dell-style Item 1A headings that use long-dash separators", () => {
  const html = `
    <h2>ITEM 1A&#160;&#8212; RISK FACTORS</h2>
    <p>Competitive pressures may adversely affect our market position, revenue, and profitability.</p>
    <p>Cybersecurity incidents could disrupt our operations and expose confidential customer information.</p>
    <h2>ITEM 1B&#160;&#8212; UNRESOLVED STAFF COMMENTS</h2>
  `;
  const themes = extractRiskFactorThemes(html, "10-K", 8);
  assert.ok(themes.some((theme) => theme.key === "competition-innovation"));
  assert.ok(themes.some((theme) => theme.key === "cybersecurity-data-privacy"));
});
