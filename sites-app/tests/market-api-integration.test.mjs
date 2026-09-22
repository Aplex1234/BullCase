import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildFinancialExplorerData, FINANCIAL_GROUPS } from "../../frontend/lib/financials.ts";
import { normalizeCompanyFacts, normalizeQuarterlyCompanyFacts } from "../lib/server/sec-normalizer.ts";
import { getInitialsBadgeStyle, getLogoCandidates, getTickerInitials, normalizeTicker } from "../../frontend/lib/logo.ts";
import { parseSecurityMaster, searchSecurityEntries } from "../lib/server/security-master.ts";


test("serves normalized delayed Nasdaq price history for the stock chart", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      tradesTable: {
        rows: [
          { date: "08/08/2026", close: "$105.25", open: "$104.00", high: "$106.10", low: "$103.90", volume: "1,200,000" },
          { date: "08/07/2026", close: "$103.75", open: "$102.50", high: "$104.20", low: "$101.80", volume: "950,000" },
          { date: "08/06/2026", close: "$102.00", open: null, high: "$103.00", low: "$101.00", volume: "800,000" },
        ],
      },
    },
  }), { headers: { "content-type": "application/json" } });

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("price-history-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/companies/TEST/price-history"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    const history = payload.data;
    assert.equal(history.provider, "Nasdaq delayed historical prices");
    assert.deepEqual(history.points.map((point) => point.date), ["2026-08-07", "2026-08-08"]);
    assert.equal(history.points.at(-1).close, 105.25);
    assert.equal(history.points.at(-1).volume, 1_200_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves one-day intraday prices with pre-market and after-hours enabled", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (request) => {
    requestedUrl = String(request);
    return new Response(JSON.stringify({
      chart: {
        result: [{
          timestamp: [1786622400, 1786651200, 1786672800],
          indicators: {
            quote: [{
              open: [228.1, 230.0, 231.4],
              high: [228.6, 232.0, 231.9],
              low: [227.9, 229.7, 230.8],
              close: [228.4, 231.6, 231.1],
              volume: [120_000, 1_500_000, 210_000],
            }],
          },
        }],
        error: null,
      },
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("intraday-price-history-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/companies/AAPL/price-history?range=1d"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.range, "1d");
    assert.equal(payload.data.provider, "Yahoo Finance intraday prices including extended hours");
    assert.match(requestedUrl, /range=1d/);
    assert.match(requestedUrl, /interval=5m/);
    assert.match(requestedUrl, /includePrePost=true/);
    assert.match(payload.data.points[0].date, /T/);
    assert.equal(payload.data.points.length, 3);

    const component = await readFile(new URL("../../frontend/components/StockPriceChart.tsx", import.meta.url), "utf8");
    assert.match(component, /key: "1d", label: "1D"/);
    assert.match(component, /Trading session colors/);
    assert.match(component, /dataKey="regularClose"/);
    assert.match(component, /dataKey="extendedClose"/);
    assert.match(component, />Regular session</);
    assert.match(component, />Pre-market \/ after-hours</);
    assert.match(component, /previousRegularSession !== regularSession/);
    assert.match(component, /regularClose: regularSession \|\| sessionChanged \? point\.close : null/);
    assert.match(component, /extendedClose: !regularSession \|\| sessionChanged \? point\.close : null/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves maximum available Yahoo Finance history for long chart ranges", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [345479400, 1786132800],
        indicators: {
          quote: [{
            open: [0.13, 225.0],
            high: [0.14, 230.0],
            low: [0.12, 224.0],
            close: [0.13, 229.5],
            volume: [469_033_600, 54_000_000],
          }],
        },
      }],
      error: null,
    },
  }), { headers: { "content-type": "application/json" } });

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("max-price-history-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/companies/LONG/price-history?range=max"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.range, "max");
    assert.equal(payload.data.provider, "Yahoo Finance historical prices");
    assert.equal(payload.data.points.length, 2);
    assert.equal(payload.data.points[0].close, 0.13);
    assert.equal(payload.data.points.at(-1).close, 229.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unsupported price-history ranges instead of silently returning one-year data", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("invalid-range-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/companies/AAPL/price-history?range=quarter-century"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    detail: "Unsupported price-history range.",
    code: "invalid_request",
  });
});

test("normalizes Mastercard tag transitions and comparative annual facts", () => {
  const annual = (fy, start, end, val, filed = "2026-02-11") => ({
    form: "10-K",
    fp: "FY",
    fy,
    start,
    end,
    filed,
    val,
    accn: "0001141391-26-000013",
  });
  const instant = (fy, end, val) => ({
    form: "10-K",
    fp: "FY",
    fy,
    end,
    filed: "2026-02-11",
    val,
    accn: "0001141391-26-000013",
  });
  const payload = {
    cik: 1141391,
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
          annual(2021, "2021-01-01", "2021-12-31", 29_845_000_000, "2022-02-11"),
        ] } },
        Revenues: { units: { USD: [
          annual(2023, "2022-01-01", "2022-12-31", 22_237_000_000, "2024-02-13"),
          annual(2025, "2023-01-01", "2023-12-31", 25_098_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 28_167_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 32_791_000_000),
        ] } },
        OperatingIncomeLoss: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 14_008_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 15_582_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 18_897_000_000),
        ] } },
        NetIncomeLoss: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 11_195_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 12_874_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 15_022_000_000),
        ] } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 11_980_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 14_780_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 17_648_000_000),
        ] } },
        PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [
          annual(2025, "2023-01-01", "2023-12-31", 371_000_000),
          annual(2025, "2024-01-01", "2024-12-31", 474_000_000),
          annual(2025, "2025-01-01", "2025-12-31", 489_000_000),
        ] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(2025, "2025-12-31", 10_566_000_000)] } },
        Assets: { units: { USD: [instant(2025, "2025-12-31", 54_157_000_000)] } },
        Liabilities: { units: { USD: [instant(2025, "2025-12-31", 46_411_000_000)] } },
        StockholdersEquity: { units: { USD: [instant(2025, "2025-12-31", 7_737_000_000)] } },
        LongTermDebtNoncurrent: { units: { USD: [instant(2025, "2025-12-31", 18_251_000_000)] } },
      },
    },
  };

  const periods = normalizeCompanyFacts(payload);
  assert.deepEqual(periods.map((period) => period.fiscal_year), [2021, 2022, 2023, 2024, 2025]);
  assert.equal(periods.at(-1).values.revenue, 32_791_000_000);
  assert.equal(periods.at(-1).values.operating_income, 18_897_000_000);
  assert.equal(periods.at(-1).values.cash_and_investments, 10_566_000_000);
  assert.equal(periods.at(-1).values.total_assets, 54_157_000_000);
  assert.equal(periods.at(-1).values.total_debt, 18_251_000_000);
  assert.equal(periods.at(-1).values.free_cash_flow, 17_159_000_000);

  const balanceGroup = FINANCIAL_GROUPS.find((group) => group.key === "balanceSheet");
  const chart = buildFinancialExplorerData(periods, balanceGroup);
  assert.equal(chart.at(-1).cash_and_investments, 10.566);
  assert.equal(chart.at(-1).total_assets, 54.157);
});

test("normalizes stand-alone SEC quarters and derives fourth-quarter cash flow", () => {
  const duration = (fy, fp, start, end, val, form = "10-Q") => ({
    form,
    fp,
    fy,
    start,
    end,
    filed: form === "10-K" ? "2026-02-15" : `${end.slice(0, 7)}-25`,
    val,
    accn: `quarter-${fy}-${fp}`,
  });
  const instant = (fy, fp, end, val, form = "10-Q") => ({
    form,
    fp,
    fy,
    end,
    filed: form === "10-K" ? "2026-02-15" : `${end.slice(0, 7)}-25`,
    val,
    accn: `instant-${fy}-${fp}`,
  });
  const payload = {
    cik: 123456,
    facts: { "us-gaap": {
      Revenues: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 100),
        duration(2025, "Q2", "2025-04-01", "2025-06-30", 120),
        duration(2025, "Q3", "2025-07-01", "2025-09-30", 140),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 520, "10-K"),
      ] } },
      NetIncomeLoss: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 20),
        duration(2025, "Q2", "2025-04-01", "2025-06-30", 24),
        duration(2025, "Q3", "2025-07-01", "2025-09-30", 28),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 100, "10-K"),
      ] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 100),
        duration(2025, "Q2", "2025-01-01", "2025-06-30", 250),
        duration(2025, "Q3", "2025-01-01", "2025-09-30", 450),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 700, "10-K"),
      ] } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [
        duration(2025, "Q1", "2025-01-01", "2025-03-31", 10),
        duration(2025, "Q2", "2025-01-01", "2025-06-30", 25),
        duration(2025, "Q3", "2025-01-01", "2025-09-30", 45),
        duration(2025, "FY", "2025-01-01", "2025-12-31", 70, "10-K"),
      ] } },
      Assets: { units: { USD: [
        instant(2025, "Q1", "2025-03-31", 1_000),
        instant(2025, "Q2", "2025-06-30", 1_050),
        instant(2025, "Q3", "2025-09-30", 1_100),
        instant(2025, "FY", "2025-12-31", 1_200, "10-K"),
      ] } },
    } },
  };

  const quarters = normalizeQuarterlyCompanyFacts(payload);
  assert.deepEqual(quarters.map((period) => period.period_type), ["Q1", "Q2", "Q3", "Q4"]);
  assert.deepEqual(quarters.map((period) => period.values.revenue), [100, 120, 140, 160]);
  assert.deepEqual(quarters.map((period) => period.values.operating_cash_flow), [100, 150, 200, 250]);
  assert.deepEqual(quarters.map((period) => period.values.capex), [10, 15, 20, 25]);
  assert.deepEqual(quarters.map((period) => period.values.free_cash_flow), [90, 135, 180, 225]);
  assert.deepEqual(quarters.map((period) => period.values.total_assets), [1_000, 1_050, 1_100, 1_200]);
});

test("searches the SEC security universe with stable listing identities", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://www.sec.gov/files/company_tickers_exchange.json") {
      return new Response(JSON.stringify({
        fields: ["cik", "name", "ticker", "exchange"],
        data: [
          [320193, "Apple Inc.", "AAPL", "Nasdaq"],
          [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
          [1652044, "Alphabet Inc.", "GOOGL", "Nasdaq"],
          [1067983, "Berkshire Hathaway Inc.", "BRK-B", "NYSE"],
        ],
      }), { headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, init);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("search-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/search?q=BRK.B&limit=8"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload[0].ticker, "BRK-B");
    assert.equal(payload[0].issuer_id, "sec-cik:0001067983");
    assert.equal(payload[0].listing_id, "listing:xnys:brk-b");
    assert.equal(payload[0].mic, "XNYS");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ranks an exact company brand ahead of longer lookalike names", () => {
  const entries = parseSecurityMaster({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [
      [2010630, "Apple iSports Group, Inc.", "AAPI", "Nasdaq"],
      [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    ],
  });

  const results = searchSecurityEntries(entries, "apple", 8);
  assert.equal(results[0]?.ticker, "AAPL");
  assert.equal(results[0]?.name, "Apple Inc.");
});

test("serves a complete AAPL analysis through the hosted API", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/companies/AAPL/analysis"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=300/);
  assert.match(response.headers.get("server-timing") ?? "", /app;dur=/);
  assert.ok(response.headers.get("etag"));
  const payload = await response.json();
  assert.equal(payload.data.company.ticker, "AAPL");
  assert.ok(payload.data.financials.length >= 5);
  assert.ok(Array.isArray(payload.data.quarterly_financials));
  assert.ok(Array.isArray(payload.data.analyst_estimates.quarterly));
  assert.ok(Number.isFinite(payload.data.headline.fair_value));
  assert.ok(Number.isFinite(payload.data.metrics.pe));
  assert.ok(Number.isFinite(payload.data.metrics.price_to_book));
  assert.ok(Number.isFinite(payload.data.metrics.revenue_growth_yoy));
  assert.ok(Number.isFinite(payload.data.metrics.net_income_growth_yoy));
  assert.ok(Number.isFinite(payload.data.valuation.growth_projection.peg_ratio));
  assert.ok(payload.data.headline.buy_target < payload.data.headline.fair_value);
  assert.equal(payload.data.score.overall >= 0 && payload.data.score.overall <= 100, true);

  const overviewResponse = await worker.fetch(
    new Request("http://localhost/api/v1/companies/AAPL/analysis?view=overview"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(overviewResponse.status, 200);
  const overviewPayload = await overviewResponse.json();
  assert.equal(overviewPayload.data.data_scope, "overview");
  assert.deepEqual(overviewPayload.data.quarterly_financials, []);
  assert.deepEqual(overviewPayload.data.comps, []);
  assert.deepEqual(overviewPayload.data.filings, []);
  assert.deepEqual(overviewPayload.data.risks, []);
  assert.ok(JSON.stringify(overviewPayload.data).length < JSON.stringify(payload.data).length * 0.5);

  const financialsResponse = await worker.fetch(
    new Request("http://localhost/api/v1/companies/AAPL/analysis?view=financials"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(financialsResponse.status, 200);
  const financialsPayload = await financialsResponse.json();
  assert.equal(financialsPayload.data.data_scope, "partial");
  assert.deepEqual(financialsPayload.data.loaded_sections, ["overview", "financials"]);
  assert.ok(financialsPayload.data.quarterly_financials.length > 0);
  assert.deepEqual(financialsPayload.data.comps, []);
  assert.ok(financialsPayload.data.analyst_estimates.annual.length > 0);
});

test("resolves logo candidates and robust fallback initials for required companies", () => {
  const testedCompanies = [
    { ticker: "AAPL", name: "Apple Inc.", expectedInitials: "AA", domainMatch: "apple.com" },
    { ticker: "MSFT", name: "Microsoft Corporation", expectedInitials: "MS", domainMatch: "microsoft.com" },
    { ticker: "TSLA", name: "Tesla, Inc.", expectedInitials: "TS", domainMatch: "tesla.com" },
    { ticker: "MA", name: "Mastercard Incorporated", expectedInitials: "MA", domainMatch: "mastercard.com" },
    { ticker: "DELL", name: "Dell Technologies Inc.", expectedInitials: "DE", domainMatch: "dell.com" },
    { ticker: "SNDK", name: "Sandisk Corporation", expectedInitials: "SN", domainMatch: "sandisk.com" },
    { ticker: "BRK.B", name: "Berkshire Hathaway Inc.", expectedInitials: "BRK", domainMatch: "berkshirehathaway.com" },
    { ticker: "BRK.A", name: "Berkshire Hathaway Inc.", expectedInitials: "BRK", domainMatch: "berkshirehathaway.com" },
    { ticker: "BRK-B", name: "Berkshire Hathaway Inc.", expectedInitials: "BRK", domainMatch: "berkshirehathaway.com" },
    { ticker: "W", name: "Wayfair Inc.", expectedInitials: "W", domainMatch: "wayfair.com" },
  ];

  for (const company of testedCompanies) {
    const candidates = getLogoCandidates(company.ticker);
    assert.ok(candidates.length >= 2, `Expected at least 2 logo candidates for ${company.ticker}, got ${candidates.length}`);
    assert.ok(candidates[0].includes("assets.parqet.com"), `Primary candidate for ${company.ticker} must be Parqet symbol PNG: ${candidates[0]}`);
    assert.ok(candidates.some((url) => url.includes("financialmodelingprep.com")), `Candidates for ${company.ticker} must include FMP: ${candidates}`);
    if (company.domainMatch) {
      assert.ok(candidates.some((url) => url.includes(company.domainMatch)), `Candidates for ${company.ticker} must include domain fallback: ${candidates}`);
    }

    const initials = getTickerInitials(company.ticker, company.name);
    assert.equal(initials, company.expectedInitials, `Initials for ${company.ticker} mismatch`);

    const badgeStyle = getInitialsBadgeStyle(company.ticker);
    assert.ok(badgeStyle.background.startsWith("hsl("));
    assert.ok(badgeStyle.color.startsWith("hsl("));
  }

  // Ticker normalization
  assert.equal(normalizeTicker("BRK.B"), "BRK-B");
  assert.equal(normalizeTicker("brk.a"), "BRK-A");
  assert.equal(normalizeTicker("w"), "W");

  // Initials fallback when no ticker is provided
  assert.equal(getTickerInitials("", "Tesla Motors"), "TM");
  assert.equal(getTickerInitials("", "Wayfair"), "WA");
});
