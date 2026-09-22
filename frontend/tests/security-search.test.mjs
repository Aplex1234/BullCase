import assert from "node:assert/strict";
import test from "node:test";
import * as recentStorage from "../lib/security-search.ts";

import {
  RECENT_SECURITIES_LIMIT,
  addRecentSecurity,
  mergeSecurityOptions,
  parseRecentSecurities,
} from "../lib/security-search.ts";

function security(ticker) {
  return {
    issuer_id: `issuer:${ticker}`,
    security_id: `security:${ticker}`,
    listing_id: `listing:${ticker}`,
    ticker,
    name: `${ticker} Company`,
    cik: ticker,
    exchange: "Nasdaq",
    mic: "XNAS",
    security_type: "Common stock",
    coverage: "SEC filings",
  };
}

test("blocked or full browser storage cannot break recent-company handling", () => {
  const blocked = () => { throw new Error("SecurityError"); };
  assert.deepEqual(recentStorage.loadRecentSecurities(blocked), []);
  assert.doesNotThrow(() => recentStorage.saveRecentSecurities([security("AAPL")], blocked));
  const full = () => ({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } });
  assert.doesNotThrow(() => recentStorage.saveRecentSecurities([security("AAPL")], full));
});

test("parses only valid recent-company records and tolerates corrupt storage", () => {
  assert.deepEqual(parseRecentSecurities("not-json"), []);
  assert.deepEqual(parseRecentSecurities(JSON.stringify([null, { ticker: "BAD" }, security("AAPL")])), [security("AAPL")]);
});

test("keeps recent companies unique, newest first, and bounded", () => {
  const initial = ["AAPL", "MSFT", "NVDA", "COST", "JPM"].map(security);
  const repeated = addRecentSecurity(initial, security("NVDA"));
  assert.deepEqual(repeated.map((item) => item.ticker), ["NVDA", "AAPL", "MSFT", "COST", "JPM"]);

  const next = addRecentSecurity(repeated, security("WMT"));
  assert.equal(next.length, RECENT_SECURITIES_LIMIT);
  assert.deepEqual(next.map((item) => item.ticker), ["WMT", "NVDA", "AAPL", "MSFT", "COST"]);
});

test("places live matches before recent companies without duplicate tickers", () => {
  const results = [security("AAPL"), security("AMZN")];
  const recent = [security("AAPL"), security("MSFT")];
  const merged = mergeSecurityOptions(results, recent);
  assert.deepEqual(merged.uniqueRecent.map((item) => item.ticker), ["MSFT"]);
  assert.deepEqual(merged.options.map((item) => item.ticker), ["AAPL", "AMZN", "MSFT"]);
});
