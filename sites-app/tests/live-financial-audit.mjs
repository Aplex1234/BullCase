// Opt-in verification against the SEC's public Company Facts feed.
// Run with SEC_USER_AGENT set to a genuine project contact.
import assert from "node:assert/strict";
import { normalizeCompanyFacts, normalizeQuarterlyCompanyFacts } from "../lib/server/sec-normalizer.ts";
import { calculateMetrics, calculateValuation, DEFAULT_ASSUMPTIONS } from "../lib/server/financial-model.ts";

assert.match(process.env.SEC_USER_AGENT ?? "", /@/, "Set a contact-identifying SEC_USER_AGENT before running the live audit.");
const companies = [
  { ticker: "AAPL", cik: "0000320193", end: "2025-09-27", expected: { revenue: 416161e6, operating_cash_flow: 111482e6, capex: 12715e6, free_cash_flow: 98767e6, total_debt: 98657e6, diluted_shares: 15004697e3, shares_outstanding: 14773260e3 } },
  { ticker: "NVDA", cik: "0001045810", end: "2026-01-25", expected: { revenue: 215938e6, operating_cash_flow: 102718e6, capex: 6042e6, free_cash_flow: 96676e6, total_debt: 8468e6, diluted_shares: 24514e6, shares_outstanding: 24304e6 } },
  { ticker: "COST", cik: "0000909832", end: "2025-08-31", expected: { revenue: 275235e6, operating_cash_flow: 13335e6, capex: 5498e6, free_cash_flow: 7837e6, total_debt: 5788e6, diluted_shares: 444803e3, shares_outstanding: 443237e3 } },
];
for (const company of companies) {
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `${company.ticker} SEC response`);
  const facts = await response.json();
  const periods = normalizeCompanyFacts(facts);
  const audited = periods.find(p => p.period_end === company.end);
  assert.ok(audited, `${company.ticker} reference annual period must exist`);
  for (const [key, expected] of Object.entries(company.expected)) assert.equal(audited.values[key], expected, `${company.ticker} ${key}`);
  for (const quarter of normalizeQuarterlyCompanyFacts(facts)) {
    assert.ok(quarter.values.diluted_shares == null || quarter.values.diluted_shares > 0, `${company.ticker} ${quarter.fiscal_year} ${quarter.period_type} positive shares`);
    if (quarter.values.operating_cash_flow != null && quarter.values.capex != null) assert.equal(quarter.values.free_cash_flow, quarter.values.operating_cash_flow - Math.abs(quarter.values.capex));
  }
  const metrics = calculateMetrics([audited], 100, 100 * audited.values.shares_outstanding);
  assert.equal(metrics.pe, metrics.market_cap / audited.values.net_income);
  assert.equal(metrics.price_to_fcf, metrics.market_cap / audited.values.free_cash_flow);
  const valuation = calculateValuation([audited], metrics, 100, { ...DEFAULT_ASSUMPTIONS, revenue_growth: 0.05 }, [], true);
  if (audited.provenance.cash_and_investments?.status === "unavailable") {
    assert.equal(metrics.net_debt, null);
    assert.equal(valuation.base_value, null);
  } else {
    let pv = 0;
    let revenue = audited.values.revenue;
    for (let year = 1; year <= 5; year++) {
      revenue *= 1.05;
      pv += revenue * metrics.fcf_margin / 1.09 ** year;
    }
    pv += revenue * metrics.fcf_margin * 1.025 / (0.09 - 0.025) / 1.09 ** 5;
    const independent = Math.max((pv - metrics.net_debt) / audited.values.shares_outstanding, 0);
    assert.ok(Math.abs(valuation.methods.dcf - independent) < 1e-8, `${company.ticker} independently calculated DCF`);
  }
  console.log(`${company.ticker}: filing values, share counts, cash-flow arithmetic and valuation checks passed`);
}
