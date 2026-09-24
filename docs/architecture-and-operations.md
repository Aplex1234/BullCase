# AplexAnalysis architecture and operations

This document describes the current production application. `sites-app/` is the deployment target; `frontend/` is shared source plus an isolated interface validation harness.

## Production request flow

1. The Cloudflare Worker in `sites-app/worker/index.ts` applies security headers, normalizes the trusted client identity, serves static assets, and checks the edge cache.
2. Vinext routes the request to the same-origin API under `sites-app/app/api/v1/`.
3. The analysis service loads a compatible D1 snapshot or assembles the requested view from cached and live components.
4. Provider modules normalize SEC and market data; pure financial-model functions calculate metrics, valuations, the Buy Target, and the score.
5. Successful results are persisted in D1 and eligible anonymous GET responses are cached at the edge.

For a cold company load, Overview remains the blocking priority and uses only its required financial and quote inputs. After that Overview succeeds, the route schedules a full-analysis warm in the background through the same cold-build rate limit, same-ticker coordinator, D1 leases, component caches, bounded queues, and provider pacing used by direct requests. A section opened before warming finishes still loads independently through the existing lazy-section path.

Stale data is served when a prior successful result exists and a provider refresh fails. Cache-write failures are non-authoritative: they must not empty an otherwise valid result.

## Repository layout

- `sites-app/app/`: Vinext pages and same-origin API routes.
- `sites-app/worker/`: Cloudflare Worker entry point, edge caching, security headers, image handling, and scheduled maintenance.
- `sites-app/lib/server/`: provider clients, normalization, peer selection, financial models, caching, rate limiting, and application orchestration.
- `sites-app/db/` and `sites-app/drizzle/`: D1 schema and ordered SQLite migrations.
- `sites-app/tests/`: hosted rendering, financial regression, cache, provider, and scaling coverage.
- `frontend/`: shared React components, hooks, styles, types, browser utilities, and a non-production Next.js harness.
- `docs/refactor/`: phase-by-phase refactor evidence and validation reports.

The principal API routes are:

- `GET /api/v1/search?q=...`: security search, limited to 20 results.
- `GET /api/v1/companies/:ticker/analysis`: full analysis or a deferred `view` such as `overview`, `comps`, `news`, or `risks`.
- `POST /api/v1/companies/:ticker/analysis`: explicit manual refresh; refresh through a GET query parameter is rejected.
- `POST /api/v1/companies/:ticker/valuation`: recalculation with bounded, validated assumptions; responses are not cached.
- `GET /api/v1/companies/:ticker/price-history?range=...`: delayed `1d`, `1y`, `5y`, or `max` price history.

## Runtime and providers

Production runs as a Vinext application in a Cloudflare Worker deployed through OpenAI Sites. The Worker uses the logical D1 binding `DB`; no R2 bucket is configured.

| Provider | Current responsibility | Failure behavior |
| --- | --- | --- |
| SEC EDGAR | ticker/CIK identity, Company Facts, submissions, filings, risk text, and financial fingerprints | Use compatible stale normalized data when available; AAPL, NVDA, and COST also have dated bundled SEC-derived fallbacks. |
| Nasdaq | delayed quotes, company profiles, analyst consensus, stock universe, company news, and one-year history | Use component/reference cache or mark the optional component unavailable. |
| Yahoo Finance | intraday, five-year, and maximum price history plus company news | Use cached history/news when available or return a safe provider error. |
| Google News RSS | industry news | Omit the failed source while preserving successful company, filing, and other news sources. |

Provider transport uses bounded timeouts, structured internal errors, safe public error messages, and no automatic retries by default. The lack of automatic retries prevents one upstream outage from multiplying external traffic. SEC requests are additionally paced across instances when D1 is available.

All valuation and scoring calculations are deterministic application code. No LLM contributes to numerical outputs.

## Database and cache model

The D1 schema separates identity from cached payloads:

- `companies` and `listings` provide stable issuer and exchange-aware listing identities.
- `normalized_financial_cache` stores normalized SEC inputs and source fingerprints.
- `analysis_cache` stores version-tagged complete snapshots.
- `component_cache` stores quote, estimates, comps, risks, and news independently.
- `price_history_cache` and `reference_data_cache` store market history and shared provider reference data.
- refresh schedules and leases coordinate stale-while-refresh work.
- rate-limit, provider-budget, and short-lived build-result tables coordinate traffic across Worker instances.
- cache event and peer-selection tables retain operational and explainability evidence.

Application cache lifetimes are centralized in `sites-app/lib/server/cache-policy.ts`:

| Data | Fresh lifetime |
| --- | ---: |
| Complete analysis | 5 minutes |
| Delayed quote | 10 minutes |
| News | 20 minutes |
| Comparable companies | 2 hours |
| Analyst estimates | 12 hours |
| SEC filing freshness check | 12 hours |
| Filing risks | 30 days |

Persistent price-history lifetimes are one minute for `1d`, one hour for `1y`, six hours for `5y`, and twelve hours for `max`. A bounded 64-entry in-memory analysis cache reduces repeated work inside one Worker instance.

Fresh anonymous analysis and price-history GET responses may also use the Cloudflare edge cache. Stale, authenticated, cookie-bearing, refresh, and error responses bypass it. Manual refresh purges the analysis edge variants for that ticker.

When D1 is unavailable, the application can still use isolate-local fallbacks for selected coordination and rate-limit behavior, but cross-instance persistence and coordination are reduced.

## Rate limiting and load protection

Signed-in requests use a Worker-stamped hash of the account's Site user ID, so users on the same network have separate limits. Anonymous requests use a hash of the connecting IP. Incoming attempts to supply the trusted identity header are overwritten. D1 fixed-window counters coordinate production limits; local development falls back to in-memory counters when D1 is unavailable. The signed-in Profile reads current counters without consuming them.

| Limit | Current policy |
| --- | ---: |
| General API requests, including searches | 50 per minute per identity |
| Searches | 50 per minute per identity, also counted in general requests |
| Manual refresh requests | 5 per hour per identity, also counted in general requests |
| Cold analysis builds | 10 per minute per identity |
| AI Research requests | 5 per minute per identity |
| Shared AI Research requests | 100 per day across the Site |
| Same-ticker manual refresh cooldown | 60 seconds |
| SEC request starts | At most 8 per second, with a bounded wait queue |

Concurrent cold requests for the same analysis share a lease and short-lived build result instead of multiplying provider work. Rate-limit responses use HTTP 429 and include `Retry-After`; a busy shared build can return HTTP 503 with the same guidance.

## Local development

Use Node.js 22.13 or newer.

```text
cd sites-app
npm install
npm run dev
```

Vinext and Miniflare simulate the declared D1 binding locally. Project-local `.wrangler/` state is generated and should not be committed.

Copy `sites-app/.env.example` to `sites-app/.env` only when overrides are needed. Do not commit `.env` files.

| Variable | Purpose | Required behavior |
| --- | --- | --- |
| `SEC_USER_AGENT` | Contact-identifying header sent to SEC APIs | Replace the example address with a real monitored contact before sustained automated use. |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for social metadata | Optional locally; set to the intended trusted production origin when it differs from the default. |
| `NEXT_PUBLIC_API_URL` | Browser API base used by shared frontend helpers | Optional; defaults to same-origin `/api/v1`. |
| `API_PROXY_URL` | API origin for the isolated `frontend/` Next.js harness | Optional and not used by the production Sites application. |

After a schema change, run `npm run db:generate`, inspect the generated SQL and metadata, and keep the ordered migration with the source change. Development may bootstrap missing tables for convenience; production relies on deployed migrations.

## Testing and CI

The production validation gate runs from `sites-app/`:

```text
npm run typecheck
npm run lint
npm test
```

`npm test` runs the production build before the complete hosted suite. Financial regressions use frozen inputs under `sites-app/tests/fixtures/financial-baseline/`; an intentional numerical correction requires separately documented expected-output changes.

The hosted tests are split into `test:unit`, `test:integration`, `test:api`, and `test:performance` scripts so focused checks can run independently while `npm test` remains the complete gate.

Shared-interface changes must also run from `frontend/`:

```text
npm run lint
npm test
npm run typecheck
npm run build
```

`.github/workflows/ci.yml` runs the production gate with `npm ci` on pushes and pull requests. CI does not deploy.

## Deployment and scheduled work

`sites-app/.openai/hosting.json` identifies the existing Sites project and declares the logical `DB` binding. Keep secrets out of that file and do not replace the project ID during routine development.

Before publishing:

1. Run the complete production and shared-interface validation gates when their sources changed.
2. Generate and inspect a migration when the D1 schema changed.
3. Verify environment values, access level, and the intended Sites project.
4. Publish through OpenAI Sites only after explicit release approval.

When the hosting platform invokes the scheduled Worker handler, it refreshes due/popular companies and prunes old cache telemetry and expired scaling state. Scheduled refresh failures keep the last successful data and are retried on a shorter interval.

## Known limitations

- Quotes and price history are delayed research data, not an execution-quality real-time market feed.
- SEC taxonomy and issuer filing styles vary. Normalization retains provenance and tests common edge cases, but every issuer and foreign-filing structure cannot be guaranteed.
- Public Nasdaq, Yahoo Finance, and Google News endpoints have no application-owned availability guarantee and may change payloads or throttle requests.
- Peer selection is explainable but heuristic. It uses product, business-model, classification, filing, and size evidence; diversified-company segment exposure is approximate, and the relevance floor may return fewer peers.
- News aggregation is filtered and capped; it is not an exhaustive media archive.
- Bundled full financial fallbacks exist only for AAPL, NVDA, and COST and are intentionally dated.
- The AI Research page is a disabled preview. No LLM provider or filing citation index is configured.
- D1 outages reduce persistent caching and cross-instance traffic coordination even though stale or isolate-local fallbacks may keep some requests available.
- AplexAnalysis is an educational research tool, not investment advice. Source filings and model assumptions still require human review.
