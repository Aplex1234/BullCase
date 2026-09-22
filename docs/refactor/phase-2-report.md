# Phase 2 scaling-protection report

## Scope

- Branch: `refactor/phase-0-1-baseline-lazy-warm`
- Starting commit: `fa69d5e Establish refactor baseline and defer full warming`
- Production runtime: `sites-app/`, using Cloudflare Workers and D1
- Production was not published during this phase
- Phase 3 has not started

## Same-ticker single-flight design

Cold Overview, requested-section, and full-analysis builds now use two coordination layers:

1. An isolate-local promise map immediately shares one promise among matching requests handled by the same Worker isolate.
2. A D1 lease coordinates matching requests across isolates. The leader builds once and writes a short-lived, scope-specific result to D1; followers poll that result and return it instead of rebuilding.

Keys include the canonical ticker and response scope, so Overview, each requested section, and full analysis do not return the wrong response shape. Shared results expire after 60 seconds. Build leases expire after 90 seconds. Cross-isolate followers wait up to 20 seconds, then receive a retryable `503` with `Retry-After: 2` rather than starting an unbounded duplicate build.

If a leader fails, it releases the lease in `finally`. Waiting isolates retry lease acquisition at a bounded interval, allowing one waiter to become the replacement leader. Failure to persist the short-lived shared result does not discard the leader's valid response; it only degrades later cross-isolate reuse.

## SEC throttling design

All current SEC network paths now pass through one `fetchSecResource` helper. Existing in-memory filing HTML reuse and D1-backed financial/reference caches remain ahead of this helper, so cached reads do not consume SEC permits.

Production permits are reserved through a single D1 provider-budget row. Starts are spaced 125 milliseconds apart, which targets eight SEC requests per second across Worker isolates and avoids the boundary burst possible with a simple one-second counter. A request may queue for up to 12 seconds; a deeper backlog fails with a retryable provider-busy error instead of bypassing the budget.

If D1 is unavailable, the helper logs the degraded state and uses an isolate-local paced fallback. That fallback is explicitly not treated as globally coordinated.

The existing declared SEC `User-Agent` remains on every request. The design keeps headroom below the SEC fair-access ceiling and follows the SEC's automated-access guidance.

## User and API abuse limits

D1 fixed-window counters provide application-wide limits across isolates:

| Limit | Budget |
| --- | ---: |
| General company, valuation, price-history, and search requests | 50 per minute per client IP |
| Manual forced refresh | 5 per hour per client IP |
| New or expensive analysis-build leaders | 10 per minute per client IP |

The general and manual-refresh budgets both apply to refresh requests. The existing one-minute per-ticker manual-refresh cooldown remains in place.

The Worker derives the client identity only from Cloudflare's inbound request context and `CF-Connecting-IP`, hashes it, overwrites any client-supplied internal identity header, and then passes the trusted hash to the route handlers. Local development deliberately uses one `local-development` identity and does not trust forwarded-IP headers.

Cloudflare's native Rate Limiting binding was not added because this Sites project exposes D1 through `.openai/hosting.json` but does not expose a rate-limit binding, the binding only supports 10- or 60-second periods, and its counters are local to a Cloudflare location. D1 supports the required one-hour refresh window and global cross-isolate coordination without describing an isolate-local counter as global.

Expired request counters and build results are pruned opportunistically and by the existing scheduled maintenance handler.

## Burst and failure behavior

- Thirty simultaneous cold AAPL requests share one build, including when the test models thirty separate isolate-local maps against one shared lease/result store.
- Same-isolate followers receive the leader's exact promise result.
- Cross-isolate followers read the leader's short-lived D1 result.
- A failed leader releases its lease; one waiter can retry and become the new leader.
- Over-limit user requests receive `429` plus `Retry-After` and `Cache-Control: no-store`.
- A cross-isolate build queue that exceeds 20 seconds receives retryable `503` rather than duplicating work.
- An SEC queue deeper than the 12-second allowance fails closed for new SEC calls instead of exceeding the paced provider budget.
- D1 limiter failure degrades to an isolate-local fallback and is logged; it is not reported as globally enforced.

## Database changes

Generated and inspected Drizzle migrations add:

- `request_rate_limits` for application-wide abuse counters
- `scaling_build_results` for short-lived cross-isolate build reuse
- `provider_request_budgets` for globally paced provider starts

The same tables are included in the non-production schema bootstrap.

## Validation

| Check | Result |
| --- | --- |
| Hosted production build | Passed |
| Hosted regression, financial baseline, and scaling suites | 81 passed, 0 failed |
| New scaling tests | 5 passed, 0 failed |
| Hosted lint | Passed |
| Shared frontend tests | 10 passed, 0 failed |
| Shared frontend typecheck | Passed |
| Shared frontend production build | Passed |
| Shared frontend lint script | Still blocked by its pre-existing obsolete `next lint` command |

The standalone Sites TypeScript command is not a configured project script. With TypeScript-extension imports enabled, it still reports the pre-existing missing `cloudflare:workers` declaration and existing errors in `analysis-service.ts` and `analysis.ts`; it reports no Phase 2 file errors. The production Vinext build passes.

## Files changed

- Analysis, search, price-history, and valuation API routes
- Worker request-identity stamping and scheduled cleanup
- Central scaling core and Cloudflare/D1 scaling-protection modules
- Minimal SEC fetch substitutions in `analysis.ts` and `security-master.ts`
- D1 schema, two generated migrations, and Drizzle metadata
- Scaling tests and the hosted test command
- This report

## Financial and user-visible behavior

No financial formula, assumption, score, valuation, buy target, peer methodology, UI layout, or normal successful response payload changed. The six frozen financial fixtures remain exact within their established tolerances.

User-visible changes are limited to overload behavior: excessive requests can now receive clear `429` responses, queued cross-isolate builds can receive retryable `503` responses after 20 seconds, and bursty cold requests should complete from one shared build instead of multiplying provider work.

## Stop point

Phase 2 is complete. Phase 3 was not started.
