import assert from "node:assert/strict";
import test from "node:test";

import { requestProviderJson } from "../lib/server/provider-http.ts";
import { buildAnalysis } from "../lib/server/analysis.ts";
import {
  FinancialDataUnavailableError,
  InvalidTickerError,
  ProviderRequestError,
  safeProviderWarning,
  toPublicApiError,
} from "../lib/server/provider-errors.ts";

test("provider outages do not produce bundled financial analysis", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("all providers unavailable"); };
  try {
    await assert.rejects(buildAnalysis("AAPL"), /unavailable|provider|request|failed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider transport applies request policy and returns parsed JSON", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const payload = await requestProviderJson<{ value: number }>({
    provider: "Nasdaq",
    operation: "quote_info",
    ticker: "AAPL",
    url: "https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks",
    headers: { Accept: "application/json", Origin: "https://www.nasdaq.com" },
    timeoutMs: 8_000,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ value: 42 }), { status: 200 });
    },
  });

  assert.deepEqual(payload, { value: 42 });
  assert.equal(requestUrl, "https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks");
  assert.equal(new Headers(requestInit?.headers).get("origin"), "https://www.nasdaq.com");
  assert.ok(requestInit?.signal instanceof AbortSignal);
});

test("provider transport classifies throttling and records structured context", async () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...values: unknown[]) => { warnings.push(values); };
  try {
    await assert.rejects(
      requestProviderJson({
        provider: "Yahoo Finance",
        operation: "price_history",
        ticker: "AAPL",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        timeoutMs: 10_000,
        fetcher: async () => new Response("busy", {
          status: 429,
          headers: { "Retry-After": "17", "X-Request-Id": "request-123" },
        }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderRequestError);
        assert.equal(error.provider, "Yahoo Finance");
        assert.equal(error.operation, "price_history");
        assert.equal(error.category, "provider_throttled");
        assert.equal(error.status, 429);
        assert.equal(error.requestId, "request-123");
        assert.equal(error.retryAfterSeconds, 17);
        return true;
      },
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[provider] request failed");
  assert.deepEqual(warnings[0][1], {
    provider: "Yahoo Finance",
    ticker: "AAPL",
    operation: "price_history",
    status: 429,
    requestId: "request-123",
    durationMs: (warnings[0][1] as { durationMs: number }).durationMs,
    category: "provider_throttled",
    message: "Yahoo Finance price_history returned 429",
  });
});

test("invalid provider JSON is a typed internal failure", async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await assert.rejects(
      requestProviderJson({
        provider: "Nasdaq",
        operation: "company_profile",
        ticker: "AAPL",
        url: "https://api.nasdaq.com/api/company/AAPL/company-profile",
        timeoutMs: 8_000,
        fetcher: async () => new Response("not-json", { status: 200 }),
      }),
      (error: unknown) => error instanceof ProviderRequestError && error.category === "provider_invalid_response",
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("public errors expose safe categories without leaking provider details", () => {
  const internal = new ProviderRequestError({
    provider: "SEC",
    operation: "company_facts",
    category: "provider_unavailable",
    ticker: "AAPL",
    status: 503,
    requestId: "secret-request-id",
    message: "SEC company_facts returned 503 from an internal endpoint",
  });
  const providerPublic = toPublicApiError(internal, "Analysis is temporarily unavailable.");
  assert.equal(providerPublic.status, 503);
  assert.equal(providerPublic.code, "provider_unavailable");
  assert.doesNotMatch(providerPublic.detail, /SEC|503|internal endpoint|secret-request-id/i);
  assert.doesNotMatch(safeProviderWarning(internal, "fallback"), /SEC|503|internal endpoint/i);

  assert.deepEqual(toPublicApiError(new InvalidTickerError("ZZZZ"), "fallback"), {
    status: 404,
    code: "invalid_ticker",
    detail: "Ticker ZZZZ was not found.",
  });
  assert.deepEqual(toPublicApiError(new FinancialDataUnavailableError("NEW"), "fallback"), {
    status: 422,
    code: "financial_data_unavailable",
    detail: "Financial data is unavailable for NEW.",
  });
  assert.deepEqual(toPublicApiError(new Error("database password leaked"), "Safe fallback."), {
    status: 500,
    code: "internal_error",
    detail: "Safe fallback.",
  });
});
