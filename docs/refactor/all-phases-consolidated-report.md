# BullCase consolidated refactor report, Phases 0-9

Final validation date: 2026-09-01  
Working branch: `refactor/phase-0-1-baseline-lazy-warm`  
Implementation status: all authorized phases are complete and validated locally  
Release status: not committed as a final release, not deployed, and not live-smoke-tested

## Executive summary for the planner

The full Phase 0-9 refactor plan was completed incrementally. The work established a frozen financial regression baseline, added cross-instance scaling protection, reduced D1 and provider work, consolidated the repository around the real production runtime, decomposed the main frontend, analysis, cache, and provider modules, and finished with CI, documentation, dependency hygiene, focused tests, and dead-code cleanup. A subsequent approved adjustment restored protected full-analysis warming after Overview and made every company selection return to Overview.

The final local state passes:

- 95 of 95 production Sites tests;
- 13 of 13 shared frontend tests;
- strict TypeScript checks for both packages;
- lint for both packages;
- the Vinext production build;
- the standalone Next.js frontend production build;
- documentation-link, stale-instruction, generated-artifact, and diff-whitespace checks.

No valuation formula, score weight, assumption default, peer-selection model, margin-of-safety rule, Buy Target rule, or financial model version was intentionally changed. The six frozen representative-company outputs continue to match the Phase 0 expectations.

The repository is now in strong condition for deliberate review and commit. It is not yet a verified production release because the branch has not been deployed or tested against a new live Sites version.

## 1. Scope and safety rules followed

The original plan required Phases 0 and 1 together, followed by explicit approval for each later phase. That sequence was followed through Phase 9. Each phase was validated before the next phase began, and no deployment occurred during the refactor.

The work preserved the existing application instead of rewriting it. Architectural changes were separated from financial logic changes, and the frozen Phase 0 fixtures were used repeatedly during higher-risk server refactors.

## 2. Current architecture

### Production application

`sites-app/` is the canonical full-stack production application and OpenAI Sites deployment target. It runs as a Vinext application in a Cloudflare Worker, exposes same-origin API routes, and uses the Sites-managed D1 `DB` binding.

The Worker owns:

- security headers;
- static asset delivery;
- trusted request identity;
- public API edge caching;
- forced-refresh cache purges;
- scheduled refresh and cleanup work.

### Shared frontend

`frontend/` is intentional shared production source. It contains the React research terminal, focused hooks and shell components, research-page views, charts, formatting, search behavior, and browser-side helpers.

Its small Next.js application is a validation harness, not the production runtime. `sites-app/` uses small compatibility adapters where shared aliases need to resolve in the Vinext build.

### Server layers

| Layer | Main responsibility |
| --- | --- |
| `analysis-service.ts` | View-specific loading, freshness, stale behavior, background refresh, and response assembly |
| `financial-model.ts` | Deterministic metrics, DCF, reverse DCF, valuation blending, scoring, and Buy Target calculations |
| `analysis.ts` | Stable public analysis entry point and final orchestration |
| `sec-provider.ts`, `nasdaq-provider.ts`, `market-data.ts`, `news.ts` | Provider-specific domain normalization and fallback behavior |
| Provider clients and `provider-http.ts` | URLs, headers, timeouts, status classification, typed failures, and structured logging |
| `peer-data.ts`, `peer-selection.ts` | Reviewed peer relationships, candidate recall, enrichment, relevance filtering, and explainable ranking |
| Cache modules | D1 access, identities, normalized sources, snapshots, components, hot memory, refresh coordination, telemetry, and policy |
| `scaling-protection.ts`, `scaling-core.ts` | Rate limits, same-ticker coordination, and globally paced SEC starts |

The operational details are maintained in `docs/architecture-and-operations.md`.

## 3. Phase-by-phase implementation record

### Phase 0: safety and financial regression baseline

Phase 0 identified the real production path before architectural work began and created an inspectable, offline financial regression baseline.

Completed work:

- confirmed `sites-app/` as the production runtime and `frontend/` as shared production source;
- recorded the pre-change build, test, typecheck, and lint state;
- fixed a test-only Windows CRLF/LF portability issue without changing production behavior;
- froze normalized provider inputs and expected outputs for AAPL, JPM, WMT, CAT, RIVN, and BRK-B;
- covered profitable technology, banking, retail, capital-intensive, loss-making, and unusual-share-structure cases;
- captured fair value, Buy Target, bear/base/bull values, DCF, comparable valuation, growth-adjusted and normalized methods, calculated metrics, scores, assumptions, and model versions;
- disabled external network access during financial fixture replay;
- used absolute tolerance `1e-6` and relative tolerance `1e-9` for floating-point comparisons.

Initial state: 67 hosted tests passed and one test-only line-ending check failed. After the baseline correction and Phase 1 work, the hosted suite passed 76 of 76.

Financial output changes: none.

### Phase 1: remove automatic full warming

Before Phase 1, a cold Overview request returned the lightweight Overview response and then scheduled a background full analysis. That background work could fetch estimates, comps, news, filing risks, and peer enrichment even if the user never opened those sections.

After Phase 1:

1. a cold Overview loads only normalized financial data and the delayed quote it needs;
2. the response returns without scheduling a full analysis;
3. expensive sections load through their existing direct section requests when opened;
4. cached Overview and scheduled lightweight popularity refresh behavior remains intact.

Expected user-visible tradeoff: the first opening of an expensive section can take longer because unused research is no longer preloaded.

Financial output changes: none.

Current behavior amendment: after the full refactor was complete, background warming was restored by explicit direction. Overview still returns without waiting for deferred research, then a full warm starts through the cold-build rate limit, same-ticker coordinator, D1 leases, component caches, bounded queues, SEC pacing, and provider protections. Lazy section loading remains the fallback when a user opens a section before its warm completes.

### Phase 2: scaling protection

Phase 2 protected cold builds and external providers without changing successful response payloads or financial calculations.

#### Same-ticker coordination

- An isolate-local promise map shares matching work inside one Worker isolate.
- D1 leases coordinate matching work across isolates.
- Keys include canonical ticker and response scope, preventing Overview, section, and full-analysis result mixing.
- Shared results expire after 60 seconds and build leases expire after 90 seconds.
- Cross-isolate followers wait up to 20 seconds, then receive a retryable `503` with `Retry-After: 2` instead of starting uncontrolled duplicate work.
- A failed leader releases its lease, allowing one waiter to become the replacement leader.
- Failure to persist a short-lived shared result does not discard the leader's valid response.

The burst test modeled 30 simultaneous cold AAPL requests sharing one upstream build.

#### SEC pacing

- All SEC network paths use the centralized SEC request helper.
- D1 coordinates request starts across isolates at 125 millisecond intervals, targeting eight SEC starts per second.
- Cached reads do not consume SEC permits.
- Requests can queue for up to 12 seconds before receiving a retryable provider-busy failure.
- D1 failure degrades to a logged isolate-local paced fallback and is not misrepresented as globally coordinated.
- The declared SEC `User-Agent` remains attached to SEC requests.

#### Abuse protection

| Request class | Limit |
| --- | ---: |
| General company, valuation, history, and search traffic | 50 per minute per client IP |
| Manual forced refresh | 5 per hour per client IP |
| New or expensive analysis-build leaders | 10 per minute per client IP |

The Worker derives identity from trusted Cloudflare request context and `CF-Connecting-IP`, hashes it, and overwrites any client-supplied internal identity header. Over-limit responses use `429`, `Retry-After`, and `Cache-Control: no-store`.

Database additions:

- `request_rate_limits`;
- `scaling_build_results`;
- `provider_request_budgets`.

Validation at phase completion: 81 hosted tests passed.

Financial output changes: none. User-visible changes occur only during excessive traffic or saturation.

### Phase 3: cache and D1 efficiency

Phase 3 reduced work for already-cached requests and verified that API cache headers alone were not previously creating edge hits.

#### Before

- A hot-isolate cached analysis typically caused about three D1 operations.
- A D1-backed cached analysis typically caused about five operations.
- Public API requests still entered the Worker and route on repeat requests.
- Cache-hit telemetry and view/refresh checks occurred too frequently.

#### Improvements

- ordinary successful cache-hit telemetry is sampled at 1 in 64 using `sample_weight` so monitoring retains an estimated count;
- company views are aggregated per isolate and flushed at most once per listing per minute;
- refresh-due checks are claimed at most once every five minutes per isolate;
- scheduled Overview refreshes use ticker-specific leases;
- safe anonymous GET analysis, section, and recognized price-history requests use the Cloudflare Cache API;
- cookies, authorization, forced refreshes, valuation POSTs, search, unknown views, and unknown query parameters bypass the edge cache;
- only public `200` responses without `Set-Cookie` are stored;
- stale persistent responses do not receive a new edge lifetime;
- cache keys normalize ticker case and dot-class notation;
- ETags can return `304` directly from edge lookup;
- forced refresh purges relevant full and section variants in the current Cloudflare location;
- fingerprinted static assets receive a one-year immutable browser lifetime.

#### After

| Request state | Expected D1 activity |
| --- | --- |
| Same-location API edge hit | Zero reads and writes; Vinext is skipped |
| Edge miss with hot isolate analysis | Normally one abuse-counter write, with view and refresh work gated |
| Edge miss with D1 analysis hit | One abuse write, one analysis read, about 1/64 telemetry write, plus gated activity |
| Edge hit for a section or price history | Zero reads and writes; provider and component-cache paths are skipped |

The edge cache exposes `X-BullCase-Edge-Cache: HIT`, `MISS`, or `BYPASS` and uses edge-specific server timing.

Database change: migration `0009_stormy_cargill.sql` adds `cache_events.sample_weight`.

Validation at phase completion: 86 hosted tests passed.

Remaining constraint: Worker-generated Cache API entries are local to a Cloudflare data center, so the first request in another location remains a miss.

Financial output changes: none.

### Phase 4: repository consolidation

The repository previously presented three apparent application areas: `backend/`, `frontend/`, and `sites-app/`. Runtime, deployment, import, and configuration evidence showed that the Python backend was no longer part of production or development.

Completed work:

- documented `sites-app/` as the production runtime;
- documented `frontend/` as intentional shared production source and an isolated validation harness;
- removed the unused 26-file, 1,648-line FastAPI/SQLAlchemy backend;
- removed the backend-only PostgreSQL `docker-compose.yml`;
- removed obsolete root environment instructions and Python-only ignore rules;
- replaced generic Sites starter documentation;
- added current root, Sites, and frontend documentation;
- made the standalone frontend API proxy opt-in instead of silently pointing to the deleted Python service;
- removed the obsolete frontend `next lint` script and later replaced it with a supported ESLint setup in Phase 5.

No production import was moved during this phase. The two-package boundary was deliberately retained to avoid high-churn path changes immediately before the frontend refactor.

Validation at phase completion: 86 hosted tests and 10 frontend tests passed, with both production builds passing.

Financial and production behavior changes: none.

### Phase 5: frontend decomposition

Before Phase 5, `ResearchTerminal.tsx` was 1,176 lines and owned state, requests, search, recents, prefetch, theme, shell UI, navigation, loading and error behavior, refresh behavior, and all ten research pages.

After Phase 5:

| Module | Responsibility | Lines at phase completion |
| --- | --- | ---: |
| `ResearchTerminal.tsx` | Top-level coordination | 125 |
| `ResearchPages.tsx` | Ten research-section views | 591 |
| `useCompanyAnalysis.ts` | Overview, deferred loading, cancellation, retry, and refresh | 175 |
| `useSecuritySearch.ts` | Autocomplete, debounce, cancellation, recents, selection, and prefetch | 146 |
| `CompanySearch.tsx` | Search UI and accessible combobox behavior | 119 |
| `CompanyHeader.tsx` | Company identity, quote, freshness, provenance, and refresh controls | 110 |
| `TerminalNavigation.tsx` | Research navigation | 68 |
| `TerminalHeader.tsx` | Brand, search placement, coverage, and theme control | 42 |
| `useTerminalTheme.ts` | Theme persistence | 26 |
| `security-search.ts` | Pure recent-company and result-merging helpers | 40 |

The top-level component decreased by 89.4 percent, from 1,176 to 125 lines.

Preserved behavior includes request cancellation, 250 millisecond search debounce, request deduplication, prefetching, recent companies, lazy section loading, scoped section errors, manual refresh, keyboard behavior, navigation, charts, warnings, and theme persistence.

Phase 5 also added focused search-helper tests and a working ESLint 9 flat configuration.

Validation at phase completion: 86 hosted tests and 13 frontend tests passed, with lint, typecheck, and both builds passing.

Financial and user-visible behavior changes: none intended or observed.

### Phase 6: core analysis decomposition

Phase 6 was the highest-risk structural phase and continuously replayed the Phase 0 financial fixtures.

Before Phase 6, `analysis.ts` was 1,401 lines and combined public contracts, fallback data, calculations, providers, filing parsing, peers, caches, and response orchestration.

After Phase 6:

| Module | Responsibility | Lines at phase completion |
| --- | --- | ---: |
| `analysis.ts` | Compatibility exports and final orchestration | 202 |
| `analysis-types.ts` | Shared server-domain contracts | 156 |
| `fallback-data.ts` | Bundled SEC-derived fallback periods and dated prices | 130 |
| `financial-model.ts` | Pure metrics, valuation, scoring, and Buy Target calculations | 231 |
| `nasdaq-provider.ts` | Profiles, estimates, universe data, delayed quotes | 251 |
| `sec-provider.ts` | SEC facts, submissions, normalization, filings, and fingerprints | 200 |
| `peer-data.ts` | Reviewed evidence, recall, enrichment, filtering, and peer metrics | 331 |

The compatibility entry point decreased by 85.6 percent by line count and 88.1 percent by byte size. Existing callers retained the same import surface.

The frozen suite passed before the refactor, after every meaningful extraction, and in the final complete suite. Direct saved-output comparison found no difference across headline values, metrics, methods, assumptions, reverse DCF, growth projection, Buy Target, category score, rating, or model version for all six fixtures.

Validation at phase completion: 86 hosted tests passed and the production build and lint passed.

Numerical differences: none.

### Phase 7: cache and database decomposition

Before Phase 7, `analysis-cache.ts` was an 877-line module responsible for D1 access, identities, snapshots, hot memory, normalized sources, components, leases, scheduling, telemetry, and monitoring.

After Phase 7, the stable `analysis-cache.ts` facade was 54 lines and delegated to focused modules:

| Module | Responsibility | Lines at phase completion |
| --- | --- | ---: |
| `analysis-cache.ts` | Backward-compatible cache API | 54 |
| `cache-policy.ts` | TTLs, lease duration, and hot-cache bounds | 14 |
| `cache-database.ts` | D1 runtime, development bootstrap, and identities | 233 |
| `analysis-snapshot-cache.ts` | Versioned complete snapshots and compatibility | 139 |
| `hot-analysis-cache.ts` | 30-second, 64-entry LRU-style cache | 41 |
| `financial-source-cache.ts` | Normalized SEC source cache and fingerprints | 142 |
| `component-cache.ts` | Quote, estimates, comps, risks, and news cache | 100 |
| `cache-refresh.ts` | Leases, background work, popularity, and due refreshes | 130 |
| `cache-telemetry.ts` | Events, failures, peer audits, pruning, and monitoring | 142 |

The facade decreased by 93.8 percent. TTLs, compatibility versions, strict stale boundaries, two-minute analysis leases, keyed leases, hot-cache behavior, component/source caches, stale fallback, provider-failure recording, and background scheduling were preserved.

Four focused tests cover version compatibility, exact stale boundaries, corrupt payloads, 30-second expiry, least-recently-used eviction, overlapping leases, and strict lease expiry.

No D1 schema, query policy, write policy, or migration changed in this phase.

Validation at phase completion: 90 hosted tests passed.

Financial, cache-policy, and user-visible behavior changes: none.

### Phase 8: provider and error architecture

Before Phase 8, provider URLs, headers, timeout logic, raw requests, and error handling were repeated across SEC, Nasdaq, Yahoo Finance, Google News, market data, and security-master modules. Public routes could return arbitrary upstream exception text.

After Phase 8:

- `provider-http.ts` owns request execution, timeouts, status classification, request-ID capture, retry support, and structured logging;
- `provider-errors.ts` owns typed internal failures and safe public mappings;
- `sec-client.ts`, `nasdaq-client.ts`, `yahoo-client.ts`, and `google-news-client.ts` own provider-specific endpoints and request policy;
- domain modules continue parsing, normalizing, filtering, scoring, and combining data;
- SEC requests still pass through global pacing;
- automatic retries remain zero by default to avoid multiplying traffic during provider incidents;
- optional sources continue degrading independently rather than failing the whole page.

Public error mapping:

| Condition | Public behavior |
| --- | --- |
| Invalid ticker | `404`, `invalid_ticker` |
| Financial data unavailable | `422`, `financial_data_unavailable` |
| Required provider unavailable | `503`, `provider_unavailable` |
| Required provider throttled | `503`, `provider_throttled`, with safe retry guidance |
| Unexpected internal failure | `500`, `internal_error` |

Provider names, internal endpoints, request IDs, and arbitrary exception text are not exposed publicly. Internal structured logs retain provider, ticker, operation, status, correlation ID, duration, category, and a bounded message.

Validation at phase completion: 94 hosted tests passed. The direct-fetch audit found only the intentional centralized SEC pacing hook calling raw server-side `fetch()`.

User-visible change: error status and wording are safer and more accurate. Financial output changes: none.

### Phase 9: final engineering cleanup

Phase 9 completed the repository-quality pass.

#### Tests and CI

- split the former 1,905-line mixed hosted test file into six focused suites;
- reduced the largest hosted test file to 411 lines;
- organized scripts as unit, integration, API, and performance suites while preserving a single complete test gate;
- replaced brittle source-string checks for security headers and valuation request validation with compiled-Worker behavior tests;
- added a GitHub Actions workflow using Node 22.13, locked installation, typecheck, lint, tests, and the production build;
- added a supported strict Sites TypeScript gate, including unused-local and unused-parameter checking.

Final hosted test distribution:

| Suite | Result |
| --- | ---: |
| Unit | 36 passed |
| Integration | 40 passed |
| API | 9 passed |
| Performance | 10 passed |
| Total | 95 passed, 0 failed |

#### Documentation

- added `docs/architecture-and-operations.md`;
- documented the runtime, providers, caches, D1, environment variables, rate limits, testing, migrations, deployment, and known limitations;
- removed stale starter instructions;
- verified local documentation links.

#### Dependency hygiene

- updated React, React DOM, React Server DOM Webpack, Vinext, Vite, Cloudflare Vite plugin, Wrangler, and Vite RSC within their existing major-version lines;
- removed unused Tailwind and PostCSS dependencies and configuration;
- verified zero known vulnerabilities in production dependency trees;
- retained four moderate development-only Drizzle Kit advisories because the automated repair proposes a breaking downgrade.

#### Final cleanup

- removed the unused starter ChatGPT authentication helper;
- removed empty or obsolete Sites Next, Tailwind, and PostCSS configuration;
- removed an unused market-data wrapper;
- narrowed internal-only exports;
- removed obsolete starter comments;
- verified no generated build or cache artifacts are tracked;
- preserved the small `sites-app/lib/logo.ts` compatibility adapter after strict typecheck proved it is required by the shared-source alias boundary.

Phase 9 intended no user-facing or financial behavior change.

## 4. Validation progression

| Milestone | Hosted tests | Frontend tests | Other important gates |
| --- | ---: | ---: | --- |
| Initial baseline | 67 passed, 1 test-only failure | 10 passed | Production builds passed |
| Phases 0-1 | 76 passed | 10 passed | Financial fixtures established |
| Phase 2 | 81 passed | 10 passed | Scaling tests added |
| Phase 3 | 86 passed | 10 passed | Edge-cache and D1-efficiency tests added |
| Phase 4 | 86 passed | 10 passed | Legacy architecture removed safely |
| Phase 5 | 86 passed | 13 passed | Frontend lint, typecheck, and build passed |
| Phase 6 | 86 passed | 13 passed | Exact frozen-output comparison passed |
| Phase 7 | 90 passed | 13 passed | Cache boundary tests added |
| Phase 8 | 94 passed | 13 passed | Provider architecture tests added |
| Phase 9 final | 94 passed | 13 passed | Both strict typechecks, both lints, both production builds, and repository audits passed |
| Post-Phase 9 warming/navigation adjustment | 95 passed | 13 passed | Protected warm and company-to-Overview regression checks passed; all complete gates rerun |

## 5. Final validation status

### Production Sites application

| Check | Result |
| --- | --- |
| Clean locked installation | Passed |
| Strict TypeScript and unused-symbol checks | Passed |
| ESLint | Passed |
| Vinext production build | Passed |
| Hosted tests | 95 passed, 0 failed |
| Frozen financial fixtures | All six representative companies passed |

### Shared frontend

| Check | Result |
| --- | --- |
| ESLint | Passed |
| Tests | 13 passed, 0 failed |
| TypeScript | Passed |
| Next.js production build | Passed |

### Repository integrity

| Check | Result |
| --- | --- |
| Documentation links | Passed |
| Stale starter-instruction scan | Passed |
| Tracked generated-artifact scan | Passed |
| Diff whitespace check | Passed |

Browser interaction and visual-regression testing were not run because the final phase changed engineering structure, tests, documentation, and dependencies rather than the interface, and browser QA was not requested.

## 6. Dependency and security result

- `sites-app` production dependencies: zero known vulnerabilities.
- `frontend` complete and production dependency trees: zero known vulnerabilities.
- `sites-app` complete dependency tree: four moderate development-only advisories, with zero high or critical advisories.
- All four residual advisories come from `drizzle-kit@0.31.10` through deprecated `@esbuild-kit` utilities and an older `esbuild`.
- The suggested automated fix is a breaking downgrade to `drizzle-kit@0.18.1`, so it was rejected.
- Drizzle Kit is a local migration-generation tool and is not shipped as a production service.

Security improvements across the full refactor include trusted request identity, cross-instance abuse limits, SEC pacing, bounded request bodies, safe provider errors, response security headers, cautious cache eligibility, and a production dependency tree with no reported advisories.

## 7. Performance and scalability result

- Overview returns first, then immediately schedules the remaining research warm through the protected full-build path.
- Lazy section loading remains available if a requested section has not finished warming.
- Same-ticker cold requests share work within and across Worker isolates.
- Cross-isolate waits and SEC queues are bounded and fail with retry guidance.
- Same-location public edge hits bypass Vinext, D1, application caches, and providers.
- Hot analysis memory is bounded to 64 entries and 30 seconds.
- Ordinary hit telemetry is sampled, views are aggregated, and refresh-due checks are throttled.
- Scheduled refresh and cleanup work uses leases.
- General traffic, forced refresh, and cold builds have separate abuse limits.
- Static fingerprinted assets receive immutable browser caching.

Live regional latency, cache-hit ratios, rate-limit behavior, provider load, and D1 cost still require observation after an approved deployment.

## 8. User-visible behavior changes

The refactor intentionally kept normal successful application behavior stable. The expected visible differences are:

- Overview remains the initial priority, while later sections usually benefit from immediate protected background warming;
- selecting or searching for a different company always opens that company's Overview, regardless of the previous active page;
- abusive traffic can receive `429` responses;
- saturated cold-build or provider queues can receive retryable `503` responses;
- eligible repeated anonymous requests can be faster through edge caching;
- technical edge-cache status headers are available;
- invalid ticker and required-provider failures now use safer, more accurate public statuses and messages.

There was no intentional visual redesign, navigation removal, financial display change, or normal successful API payload change.

## 9. Financial-model result

No valuation formula, assumption default, DCF method, reverse-DCF method, peer-multiple method, normalized valuation, growth adjustment, score weight, margin-of-safety rule, Buy Target rule, or model version was intentionally changed.

The six frozen company outputs remain consistent with Phase 0 within the established tolerances. During Phase 6, the saved outputs were also compared directly after each extraction and no headline value, metric, method, assumption, score, rating, or model version changed.

Peer-selection architecture was reorganized, but peer methodology and scoring rules were not intentionally changed. The separate proposal concerning filing-backed reciprocity, segment-aware exposure, and broader peer candidate recall remains future product work rather than part of this refactor.

## 10. Remaining technical debt and limitations

1. Four moderate development-only Drizzle Kit advisories remain until upstream dependencies are fixed or the migration tool is deliberately replaced.
2. `analysis-service.ts`, `sec-normalizer.ts`, and `ResearchPages.tsx` remain substantial but cohesive modules. Further splitting should be driven by real feature growth.
3. Some UI layout and wiring tests still inspect source or CSS because there is no component-browser or visual-regression harness.
4. The two-package shared-source boundary requires small Sites-side alias adapters and adds maintenance overhead.
5. SEC taxonomy and filing structures vary between issuers and periods.
6. Public Nasdaq, Yahoo Finance, and Google News endpoints do not provide an application-owned availability guarantee.
7. Complete bundled financial fallbacks cover only AAPL, NVDA, and COST and are intentionally dated.
8. Peer selection remains heuristic for diversified-company segment exposure, despite evidence-backed explanations and a strict relevance floor.
9. The AI Research page remains a disabled preview without an LLM provider or filing citation index.
10. The refactor is locally validated but not yet committed, deployed, or verified on the live Sites environment.

## 11. Critical engineering ratings

| Area | Rating | Reason |
| --- | ---: | --- |
| Architecture | 8.8/10 | Production ownership and layers are clear; the shared-source boundary still adds adapter complexity. |
| Maintainability | 8.5/10 | Major monoliths were decomposed and policies centralized; several cohesive large modules remain. |
| Readability | 8.4/10 | Responsibilities are substantially clearer; normalization and page rendering remain dense. |
| Testing | 8.8/10 | Strong frozen-financial, API, cache, provider, and performance coverage; no visual-regression layer. |
| Type safety | 8.6/10 | Strict project checks pass; JavaScript tests and compatibility declarations reduce the ceiling. |
| Performance | 8.7/10 | Lazy loading, edge caching, bounded memory, and reduced D1 writes address major paths; live observation remains. |
| Scalability | 8.8/10 | Cross-isolate coordination, D1 limits, and SEC pacing are strong; D1 failure fallback is isolate-local by design. |
| Caching | 9.0/10 | Versioned snapshots, components, stale handling, edge cache, leases, telemetry, and bounded memory form a mature design. |
| Provider isolation | 8.9/10 | Transport and domain parsing are separated with independent degradation; public upstreams remain dependencies. |
| Error handling | 8.8/10 | Safe typed categories, retry guidance, stale fallback, and non-authoritative cache writes are well covered. |
| Security hygiene | 8.5/10 | Production audit is clean and controls are strong; four development-tool advisories remain. |
| Documentation | 9.0/10 | Architecture, operations, environment, testing, deployment, rate limits, and limitations are documented. |
| Repository organization | 8.7/10 | Legacy runtime and stale configuration were removed; shared adapters and historical reports add intentional complexity. |

## 12. Planner decisions and recommended next steps

### Immediate recommendation

Review the complete working diff and group it into deliberate commits. Do not deploy directly from an unreviewed, uncommitted working tree.

### Release path, only after approval

1. review the branch diff and confirm the intended migration set;
2. create reviewable commits or a pull request;
3. run the complete local CI-equivalent gate one final time on the committed state;
4. deploy only with explicit user authorization;
5. smoke-test Overview, every deferred section, search, valuation, price history, forced refresh, error mapping, cache headers, and the six representative tickers;
6. observe D1 activity, edge-cache hit ratios, rate-limit events, provider failures, queue timeouts, and scheduled refresh behavior;
7. keep a rollback target for the previous live deployment.

### Decisions that can remain deferred

- Replacing Drizzle Kit is not urgent because the advisories are development-only and the available automated repair is a breaking downgrade.
- Further splitting the remaining large modules should wait for concrete feature pressure.
- A component-browser and visual-regression layer would improve confidence before future UI redesigns.
- Filing-backed reciprocal peer evidence, segment-aware matching, and expanded candidate recall should be planned as a separate financial-product change with its own acceptance tests.
- Enabling AI Research requires a separate product decision covering provider choice, source citation, cost, and failure behavior.

## Final status

All Phases 0 through 9 and the approved post-refactor warming/navigation adjustment are complete and validated locally. The consolidated result is ready for planner review. The next boundary is release review and commit, followed by deployment and live validation only if explicitly authorized.
