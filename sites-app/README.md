# AplexAnalysis production application

This directory is the canonical full-stack AplexAnalysis application deployed through OpenAI Sites.

The repository-level [`architecture and operations guide`](../docs/architecture-and-operations.md) is the detailed source of truth for runtime behavior, providers, persistence, caching, environment variables, rate limits, testing, deployment, and known limitations.

## Architecture

- `app/` contains the Vinext page and same-origin API routes.
- `worker/` is the Cloudflare Worker entry point for security headers, edge caching, static assets, and scheduled maintenance.
- `lib/server/` contains SEC and market-data retrieval, normalization, valuation, scoring, peer selection, caching, and scaling protection.
- `db/` and `drizzle/` contain the D1 schema and ordered migrations.
- `tests/` contains hosted route, rendering, financial regression, scaling, and cache-efficiency coverage.
- `../frontend/` contains the shared production UI and browser-side financial utilities imported by this application.

The core analysis path under `lib/server/` is split by responsibility:

- `analysis.ts` orchestrates source selection and assembles the final response while preserving the public analysis API.
- `analysis-types.ts` owns shared server-domain contracts.
- `financial-model.ts` contains pure metric, valuation, scoring, and buy-target calculations.
- `sec-provider.ts` owns SEC facts, filing retrieval, filing risks, and financial fingerprints.
- `nasdaq-provider.ts` owns Nasdaq profiles, analyst estimates, the stock universe, and delayed quotes.
- `peer-data.ts` owns reviewed peer seeds, candidate enrichment, relevance filtering, and comparable-company assembly.
- Provider failures return explicit API errors when no truthful last-successful cache is available; the runtime contains no bundled financial snapshots or historical quote substitutions.

The cache path keeps `analysis-cache.ts` as the stable import surface while separating implementation concerns:

- `cache-database.ts` owns the D1 binding, development schema bootstrap, and company/listing identity persistence.
- `analysis-snapshot-cache.ts` owns version-compatible full-analysis snapshots.
- `hot-analysis-cache.ts` owns the bounded, short-lived in-memory analysis cache.
- `financial-source-cache.ts` owns normalized SEC financial-source persistence and fingerprint freshness.
- `component-cache.ts` owns quote, estimates, comps, risks, and news component entries.
- `cache-refresh.ts` owns leases, view aggregation, due-refresh selection, and background scheduling.
- `cache-telemetry.ts` owns sampled cache events, provider failures, peer audits, pruning, and monitoring summaries.
- `cache-policy.ts` centralizes the unchanged TTL and cache-bound constants.

External provider transport is also separated from financial-domain parsing:

- `provider-http.ts` applies shared timeout/retry policy, typed failures, request-ID capture, and structured failure logging.
- `sec-client.ts` centralizes SEC URLs, contact headers, and the existing global SEC pacing hook.
- `nasdaq-client.ts`, `yahoo-client.ts`, and `google-news-client.ts` centralize provider URLs and request headers.
- `provider-errors.ts` separates internal provider/application errors from safe public API error codes and messages.
- `sec-provider.ts`, `nasdaq-provider.ts`, `market-data.ts`, and `news.ts` retain provider-specific payload parsing and domain normalization.

Automatic transport retries remain disabled by default so an upstream outage cannot multiply SEC or market-data traffic. Existing stale caches and protected background refreshes provide the recovery path. When required source data is unavailable and no valid cache exists, the API returns an explicit error instead of bundled or modeled substitute company data.

The Sites project and logical D1 binding are declared in `.openai/hosting.json`. Do not place runtime secrets in that file.

## Local development

Use Node.js 22.13 or newer.

```text
npm install
npm run dev
```

Copy `.env.example` to `.env` only when local overrides are needed. Replace the example SEC contact address before making sustained automated SEC requests.

## Validation

```text
npm run typecheck
npm run lint
npm test
```

`npm test` runs the production build first and then the complete hosted regression suite, including frozen financial outputs. When shared interface code changes, also run the tests, type-check, and production build from `../frontend/`.

Focused suites are available as `npm run test:unit`, `npm run test:integration`, `npm run test:api`, and `npm run test:performance`. The default test command runs all four after one production build.

The repository CI workflow runs these checks from `sites-app/` on pushes and pull requests using the locked dependency tree and Node.js 22.13.

Any financial-model refactor must continuously compare against `tests/fixtures/financial-baseline/`. Numerical changes require a separately documented, confirmed correction and must not be accepted as incidental refactor output.

After any D1 schema change, run `npm run db:generate`, inspect the generated migration, and keep the migration with the source change.

## Deployment

Publishing is handled through OpenAI Sites using the existing project declaration. The production build, migrations, and access level must be verified before a new version is deployed.
