import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompanyFacts, normalizeQuarterlyCompanyFacts } from "../lib/server/sec-normalizer.ts";
import { calculateMetrics } from "../lib/server/financial-model.ts";
import { markSnapshotFreshness } from "../lib/server/analysis-service.ts";
import { recoverOptionalSource } from "../lib/server/optional-source.ts";

const annual = (val, extra = {}) => ({ form: "10-K", fp: "FY", fy: 2025, start: "2025-01-01", end: "2025-12-31", filed: "2026-02-01", val, ...extra });
const fact = (rows, unit = "USD") => ({ units: { [unit]: rows } });
const payload = (facts) => ({ cik: 1, facts: { "us-gaap": facts } });

test("optional provider failures preserve usable core data and mark unavailable sections", async () => {
  const failure = new Error("filing document returned 403");
  const reported = [];
  const unavailable = { data: [], freshness: { status: "unavailable" } };
  const results = await Promise.all([
    Promise.resolve({ financials: [100], quote: 10 }),
    recoverOptionalSource(Promise.reject(failure), unavailable, error => reported.push(error)),
  ]);
  assert.equal(results[0].quote, 10);
  assert.equal(results[1].freshness.status, "unavailable");
  assert.deepEqual(reported, [failure]);
});

test("includes Apple's separately reported commercial paper in total debt", () => {
  const [period] = normalizeCompanyFacts(payload({
    Revenues: fact([annual(416_161_000_000)]),
    LongTermDebtNoncurrent: fact([annual(78_328_000_000, { start: undefined })]),
    LongTermDebtCurrent: fact([annual(12_350_000_000, { start: undefined })]),
    CommercialPaper: fact([annual(7_979_000_000, { start: undefined })]),
    CashAndCashEquivalentsAtCarryingValue: fact([annual(35_934_000_000, { start: undefined })]),
    MarketableSecuritiesCurrent: fact([annual(18_763_000_000, { start: undefined })]),
  }));
  assert.equal(period.values.total_debt, 98_657_000_000);
  assert.equal(period.values.net_debt, 43_960_000_000);
});

test("does not double count commercial paper included in aggregate short-term borrowings", () => {
  const [period] = normalizeCompanyFacts(payload({
    Revenues: fact([annual(100)]),
    LongTermDebtNoncurrent: fact([annual(50, { start: undefined })]),
    LongTermDebtCurrent: fact([annual(5, { start: undefined })]),
    ShortTermBorrowings: fact([annual(12, { start: undefined })]),
    CommercialPaper: fact([annual(8, { start: undefined })]),
  }));
  assert.equal(period.values.total_debt, 67);
});

test("missing investment totals do not turn cash alone into complete net debt", () => {
  const [period] = normalizeCompanyFacts(payload({
    Revenues: fact([annual(100)]),
    CashAndCashEquivalentsAtCarryingValue: fact([annual(10, { start: undefined })]),
    LongTermDebtNoncurrent: fact([annual(8, { start: undefined })]),
  }));
  assert.equal(calculateMetrics([period], 10).net_debt, null);
});

test("Q4 weighted shares use time weighting rather than subtracting three averages", () => {
  const rows = [1, 2, 3].map((q) => ({ form: "10-Q", fp: `Q${q}`, fy: 2025, start: `2025-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, end: ["2025-03-31", "2025-06-30", "2025-09-30"][q - 1], filed: ["2025-05-01", "2025-08-01", "2025-11-01"][q - 1], val: 100 }));
  const quarters = normalizeQuarterlyCompanyFacts(payload({
    Revenues: fact([...rows, annual(400)]),
    WeightedAverageNumberOfDilutedSharesOutstanding: fact([...rows, annual(100)], "shares"),
  }));
  assert.equal(quarters.at(-1).values.diluted_shares, 100);
});

test("later comparative quarters stay in their original fiscal year", () => {
  const original = { form: "10-Q", fp: "Q1", fy: 2024, start: "2024-01-01", end: "2024-03-31", filed: "2024-05-01", val: 100 };
  const quarters = normalizeQuarterlyCompanyFacts(payload({ Revenues: fact([original, { ...original, fy: 2025, filed: "2025-05-01", val: 110 }, { ...original, fy: 2025, start: "2025-01-01", end: "2025-03-31", filed: "2025-05-01", val: 150 }]) }));
  assert.equal(quarters.find(p => p.fiscal_year === 2024).values.revenue, 110);
  assert.equal(quarters.find(p => p.fiscal_year === 2025).values.revenue, 150);
});

test("a new page cache does not hide stale underlying sources", () => {
  const item = { status: "cached", as_of: "2025-01-01", fresh_until: "2099-01-01", source: "test" };
  const analysis = { freshness: { page_status: "live", financials: { ...item, status: "stale", fresh_until: null }, quote: item, analyst_estimates: item, comps: item, news: item, risks: item, summary: item } };
  const marked = markSnapshotFreshness(analysis, "cached");
  assert.equal(marked.freshness.financials.status, "stale");
  assert.equal(marked.freshness.page_status, "stale");
});

test("snapshot cleanup preserves expiry boundaries, unavailable sources, and caller status", (t) => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const keys = ["financials", "quote", "analyst_estimates", "comps", "news", "risks", "summary"];
  const cases = [
    ["live", null, "cached"],
    ["cached", "invalid", "cached"],
    ["live", new Date(now + 1).toISOString(), "cached"],
    ["cached", new Date(now).toISOString(), "stale"],
    ["live", new Date(now - 1).toISOString(), "stale"],
    ["stale", "2099-01-01", "stale"],
    ["unavailable", "2000-01-01", "unavailable"],
  ];
  for (const key of keys) {
    for (const [sourceStatus, freshUntil, expected] of cases) {
      for (const pageStatus of ["cached", "refreshing", "stale"]) {
        const item = { status: "cached", as_of: null, fresh_until: null, source: "test" };
        const analysis = { freshness: { page_status: "live", ...Object.fromEntries(keys.map(name => [name, { ...item }])) } };
        analysis.freshness[key] = { ...item, status: sourceStatus, fresh_until: freshUntil };
        const before = structuredClone(analysis);
        const marked = markSnapshotFreshness(analysis, pageStatus);
        assert.equal(marked.freshness[key].status, expected, key);
        assert.equal(marked.freshness.page_status, expected === "stale" ? "stale" : pageStatus, key);
        assert.deepEqual(analysis, before);
      }
    }
  }
  const unscoped = {};
  assert.equal(markSnapshotFreshness(unscoped, "cached"), unscoped);
});
