# Phase 3 cache and D1 efficiency report

## Scope

- Branch: `refactor/phase-0-1-baseline-lazy-warm`
- Phase 3 builds on the uncommitted Phase 2 working tree
- Production runtime: `sites-app/`, using Cloudflare Workers, D1, and static assets
- Production was not published during this phase
- Phase 4 has not started

## Before: fully cached request activity

A normal fresh full-analysis or Overview request was not being served from Cloudflare edge cache. Every public request entered the Worker and route.

For a fresh analysis already present in the isolate's 30-second hot cache, the normal path performed approximately three D1 operations:

1. One Phase 2 global abuse-counter write.
2. One company-view upsert.
3. One refresh-due query started for every fresh cached view.

For a fresh analysis not present in the isolate-local hot cache, the path added:

4. One analysis-cache read.
5. One cache-hit telemetry insert.

This made the normal estimate three D1 operations for a hot-isolate hit and five for a D1-backed hit, before any due refresh work selected a company. Requested sections could perform several component-cache reads and one telemetry insert for every successful component hit.

## Public edge-cache audit before the change

The existing public deployment was checked twice for each representative route on August 30, 2026.

| Request | First application time | Second application time | Observed edge behavior |
| --- | ---: | ---: | --- |
| AAPL Overview | 380 ms | 207 ms | No `CF-Cache-Status`; Worker application executed twice |
| AAPL Financials section | 400 ms | 168 ms | No `CF-Cache-Status`; Worker application executed twice |
| AAPL one-year price history | 18 ms | 0 ms | No `CF-Cache-Status`; second request used isolate memory but still executed the route |
| Root HTML | Not exposed | Not exposed | No `CF-Cache-Status` observed |

An API request with a matching ETag returned `304`, but still included `Server-Timing: app;dur=0`, confirming application execution. Cache-Control headers alone were not producing API edge hits.

Fingerprint-named CSS and JavaScript assets were genuine `CF-Cache-Status: HIT` responses, and conditional requests returned `304` from that cache. Cloudflare's static-asset layer was already bypassing the Worker for these files. Its default browser policy was `max-age=0, must-revalidate`.

## D1 optimizations implemented

### Sampled cache-hit telemetry

Ordinary successful cache-hit events are sampled at 1 in 64. Misses, incompatible versions, stale entries, corruption, refresh success, and provider failures are still recorded every time.

The `cache_events` table now stores `sample_weight`. A sampled hit has weight 64, and monitoring uses `SUM(sample_weight)`, preserving an estimated hit count instead of silently presenting sampled rows as complete counts. Average durations remain based on the unbiased hit sample.

### Aggregated company views

Company-view activity is accumulated in each isolate and flushed at most once per listing per minute. The next flush writes the accumulated delta, so multiple views use one D1 upsert rather than one upsert per request. If an isolate ends before another view triggers its next flush, that small pending telemetry count can be lost; this affects popularity precision, not financial correctness or cache validity.

### Throttled refresh-due checks

Fresh cached views now claim a refresh-due check at most once every five minutes per isolate instead of running one D1 query per view. The existing scheduled maintenance path remains, and any request-triggered due refresh still provides a fallback when scheduled triggers are unavailable.

Scheduled Overview refreshes now acquire a ticker-specific lease, preventing multiple isolates from rebuilding the same due company concurrently.

## API edge cache implemented

The Worker now checks Cloudflare's default Cache API before entering Vinext routes for anonymous, safe GET requests to:

- full analysis and Overview;
- each recognized analysis section; and
- stock price history for recognized ranges.

Search, valuation POSTs, forced-refresh POSTs, requests with cookies or authorization, unknown query parameters, and unknown analysis views bypass this cache. Cache keys normalize ticker case and dot-class notation.

Only `200` public responses without `Set-Cookie` are stored. Routes mark stale analysis or stale persistent price history as non-cacheable, so an old D1 response is not given a new edge lifetime while background refresh is running.

A successful forced-refresh POST remains `no-store` and purges the full-analysis plus ten section/Overview variants from the current Cloudflare location. Cache failures fail open to the application and are logged.

Edge responses expose `X-BullCase-Edge-Cache: HIT`, `MISS`, or `BYPASS`. Edge hits replace application timing with `Server-Timing: edge-cache;desc=HIT`. Matching ETags return `304` directly from the edge-cache lookup.

The Cache API test exercised the compiled Worker: the first price-history request was `MISS`, the second was `HIT`, one provider request occurred, and a matching ETag returned an edge `304`.

Cloudflare documents that its Cache API is local to a data center and does not support `stale-while-revalidate`. The application therefore uses the response's `s-maxage` as its effective edge freshness period; an expired response re-enters the route, and stale origin responses bypass storage while their existing background refresh runs. Static assets continue using Cloudflare's automatic tiered asset cache.

## Static assets

A generated `_headers` rule now gives fingerprinted `/_next/static/*` files a one-year immutable browser lifetime. The production build copies this rule to `dist/client/_headers`. This complements the already-confirmed Cloudflare asset-cache hits and removes unnecessary browser revalidation after deployment.

## After: estimated cached-request activity

| Request state | D1 activity after Phase 3 |
| --- | --- |
| Same-location API edge hit | 0 reads, 0 writes; Vinext route is skipped |
| Edge miss with hot isolate analysis | 1 abuse-counter write normally; view write at most once/minute and due query at most once/5 minutes |
| Edge miss with D1 analysis hit | 1 abuse-counter write + 1 analysis read + an expected 1/64 telemetry write, plus the gated view/due work |
| Edge hit for an analysis section | 0 reads, 0 writes; component-cache path is skipped |
| Edge hit for price history | 0 reads, 0 writes; price cache and provider path are skipped |

Compared with the former three hot-isolate operations, a typical edge miss is reduced to one D1 operation, with two gated operations occurring only at their aggregation boundaries. A non-hot D1 analysis hit falls from five operations to approximately two plus 0.016 sampled telemetry writes and the gated activity. Same-location edge hits remove D1 activity entirely.

## Database change

Generated and inspected Drizzle migration `0009_stormy_cargill.sql` adds the non-null `cache_events.sample_weight` column with a default of 1. The non-production schema bootstrap and legacy-column compatibility path include the same column.

## Validation

| Check | Result |
| --- | --- |
| Hosted production build | Passed |
| Hosted regression, financial baseline, Phase 2, and Phase 3 suites | 86 passed, 0 failed |
| New Phase 3 efficiency/cache tests | 5 passed, 0 failed |
| Hosted lint | Passed |
| Shared frontend tests | 10 passed, 0 failed |
| Shared frontend typecheck | Passed |
| Shared frontend production build | Passed |
| Generated migration inspection | Passed |
| Generated static `_headers` inspection | Passed |
| Shared frontend lint script | Still blocked by its pre-existing obsolete `next lint` command |

The standalone Sites TypeScript command still reports only the previously documented missing `cloudflare:workers` declaration and existing errors in `analysis-service.ts` and `analysis.ts`; no Phase 3 file error remains. The production Vinext build passes.

## Remaining bottlenecks and verification limits

- Cloudflare's Cache API is per data center, so the first request in another location remains an edge miss.
- It does not provide tiered caching or native stale-while-revalidate for Worker-generated Cache API entries.
- Every edge miss still writes the Phase 2 global abuse counter to D1.
- A cold or expired analysis section still performs its necessary component-cache reads and any provider refresh work; successful hit telemetry is now sampled.
- The post-change public edge headers cannot be verified until this source is published. The current public URL still runs the previous deployment.

## Financial and user-visible behavior

No financial formula, normalization rule, assumption, score, valuation, buy target, peer methodology, UI layout, or response payload changed. All six frozen financial fixtures remain exact within their established tolerances.

Expected user-visible behavior is faster repeated anonymous analysis and chart requests from the same Cloudflare location. Excessive requests, manual refreshes, personalized requests, stale responses, and errors retain their safe bypass or no-store behavior.

## Stop point

Phase 3 is complete. Phase 4 was not started.
