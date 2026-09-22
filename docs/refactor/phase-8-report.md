# Phase 8 - Provider and error architecture

## Scope

Phase 8 centralized external-provider request policy and separated public API errors from internal provider failures. It did not change financial formulas, cache policy, database schema, UI layout, or deployment state. Phase 9 was not started.

## Provider boundaries before

Provider URLs, headers, timeouts, response-status checks, and raw `fetch()` calls were repeated across:

- `sec-provider.ts` and `security-master.ts` for SEC submissions, company facts, filing documents, and the ticker master
- `nasdaq-provider.ts` for company profiles, forecasts, the stock universe, quotes, and quote summaries
- `market-data.ts` for Nasdaq and Yahoo Finance price history
- `news.ts` for Yahoo Finance, Nasdaq, and Google News

Most failures were ordinary `Error` instances. API routes often returned `error.message`, which could expose provider status text or internal details.

## Provider boundaries after

### Shared transport and errors

- `provider-http.ts` owns request execution, timeout signals, the centralized retry setting, status classification, response request-ID capture, and structured failure logging.
- `provider-errors.ts` owns typed provider errors and application categories for invalid tickers, invalid requests, unavailable financial data, and cache failures, plus safe public error mapping.

Structured provider failure logs include:

- provider
- ticker when available
- operation
- HTTP status
- provider/request correlation ID when returned
- duration
- error category
- a bounded internal message

### Provider clients

- `sec-client.ts` owns SEC data and filing endpoints, SEC contact headers, timeouts, and the existing `fetchSecResource` pacing hook.
- `nasdaq-client.ts` owns profile, forecast, screener, quote, summary, historical-price, and company-news endpoints.
- `yahoo-client.ts` owns chart and company-news endpoints.
- `google-news-client.ts` owns the industry RSS endpoint.

### Domain parsing

- `sec-provider.ts` still normalizes SEC facts, filings, descriptions, risks, and fingerprints.
- `nasdaq-provider.ts` still parses profiles, estimates, universe rows, quotes, and market capitalization.
- `market-data.ts` still normalizes price-history points and cache records.
- `news.ts` still filters, scores, deduplicates, and combines company, industry, and filing coverage.

No provider-specific raw `fetch()` remains in those domain modules. SEC requests still flow through the application-wide pacing protection.

## Request policy

- Existing timeouts are preserved: 7 seconds for news, 8 seconds for common Nasdaq requests, and 10-12 seconds for history and SEC data.
- Automatic retries default to zero. This is intentional: stale caches, background refresh, optional-provider degradation, and bundled fallbacks already provide recovery without multiplying provider traffic during an outage.
- The transport supports a bounded retry count if a future endpoint has a demonstrated need.
- HTTP 429 responses are classified as `provider_throttled`; timeouts, malformed responses, and unavailable providers have distinct internal categories.

## Public and internal error behavior

Public API responses no longer return arbitrary provider or internal exception text.

- Invalid ticker: HTTP 404, `invalid_ticker`, concise ticker message.
- Financial data unavailable after successful retrieval/normalization: HTTP 422, `financial_data_unavailable`.
- Required provider unavailable or malformed: HTTP 503, `provider_unavailable`.
- Required provider throttled: HTTP 503, `provider_throttled`, with a safe retry message and `Retry-After` when supplied upstream.
- Unexpected internal failure: HTTP 500, `internal_error`, route-specific safe text.
- Existing user-input validation messages and abuse-rate-limit responses remain specific and safe.

Fallback provenance warnings no longer append raw provider exception messages.

## Graceful degradation preserved

- Nasdaq company profile remains optional when SEC financials are available.
- Quote fallback remains available for bundled companies.
- Peer retrieval and analyst estimates still degrade to empty/unavailable data rather than failing analysis.
- Yahoo Finance, Nasdaq, and Google News remain independent; partial news results and SEC filing items survive optional-provider failures.
- Cached financials, quotes, estimates, risks, comps, and news retain the existing stale-data behavior.

## Focused tests

`provider-architecture.test.ts` verifies:

1. Shared transport applies headers and timeout signals and parses JSON.
2. HTTP 429 becomes a typed throttling error with provider, operation, ticker, status, request ID, and retry delay in structured logs.
3. Malformed provider JSON becomes a typed invalid-response failure.
4. Public mapping does not expose provider names, internal endpoint details, request IDs, or arbitrary exception text.
5. Invalid ticker, financial-data-unavailable, and unknown-error mappings remain deterministic.

Existing news tests continue to prove partial-provider degradation and total-outage rejection without overwriting stale news.

## Validation

- Frozen Phase 0 financial regression: 7/7 passed before and after the provider refactor.
- Focused provider plus financial tests: 11/11 passed.
- Production build: passed.
- Complete hosted suite: 94/94 passed.
- ESLint: passed.
- Direct-provider-fetch audit: only the centralized SEC pacing hook calls raw `fetch()` in server code.
- Diff whitespace check: passed.

The project still has no configured `typecheck` script. A diagnostic standalone TypeScript run with explicit `.ts` import support reports only the same pre-existing issues documented in Phase 7 (`analysis-service.ts`, the Cloudflare virtual module declaration, `financial-model.ts`, and `peer-data.ts`); no new Phase 8 diagnostic was introduced.

## Behavior and financial output

- User-visible behavior change: failure messages are safer and more accurately classified; invalid tickers now use 404, required-provider outages use 503, and unexpected internal failures use 500 rather than presenting raw text as 422.
- Optional-provider behavior: unchanged.
- Provider retry/load behavior: unchanged by default; no automatic retry was added.
- Financial-model changes: none.
- Frozen financial-output differences: none.
- Database or migration changes: none.
- Deployment or publishing: not performed.

## Stop point

Phase 8 is complete. Phase 9 has not begun and requires explicit authorization.
