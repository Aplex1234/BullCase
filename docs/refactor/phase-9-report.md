# Phase 9 final engineering report

Final validation date: 2026-09-01

Current behavior amendment: after Phase 9 validation, protected full-analysis warming was restored after a successful cold Overview, and every company selection was changed to open Overview. Overview does not wait for the warm. The warm uses the existing cold-build rate limit, same-ticker coordinator, D1 leases, caches, bounded queues, SEC pacing, and provider protections. Lazy section loading remains the fallback. The complete validation gates were rerun with 95 hosted tests and 13 frontend tests passing, and all six frozen financial outputs unchanged.

## 1. Current architecture

`sites-app/` is the canonical full-stack production application and OpenAI Sites deployment target. It runs as a Vinext application inside a Cloudflare Worker, exposes same-origin API routes, and uses the Sites-managed D1 binding `DB`. The Worker owns security headers, static assets, trusted request identity, edge API caching, refresh purges, and scheduled maintenance.

`frontend/` is intentional shared production source. It contains the React terminal, focused hooks and shell components, research-page views, chart and formatting utilities, search behavior, and browser-side financial helpers. Its small Next.js application is a validation harness, not the production runtime.

The server is separated into these layers:

- `analysis-service.ts` orchestrates view-specific loading, freshness, stale-data behavior, background refresh, and response assembly.
- `financial-model.ts` contains deterministic metrics, valuation, scoring, reverse DCF, and Buy Target calculations.
- `sec-provider.ts`, `nasdaq-provider.ts`, `market-data.ts`, and `news.ts` normalize provider-specific domain data.
- `sec-client.ts`, `nasdaq-client.ts`, `yahoo-client.ts`, `google-news-client.ts`, and `provider-http.ts` own transport URLs, headers, timeouts, failure classification, and request logging.
- `peer-data.ts` and `peer-selection.ts` own reviewed relationships, recall, enrichment, segment/product evidence, relevance filtering, and explainable ranking.
- the cache modules separate D1 access, identity, normalized financial inputs, complete snapshots, components, hot memory, refresh coordination, telemetry, and policy.
- `scaling-protection.ts` and `scaling-core.ts` own fixed-window limits, cross-isolate cold-build coordination, and globally paced SEC request starts.

The complete operational description is maintained in `docs/architecture-and-operations.md`.

## 2. Major improvements across all phases

### Phase 0: regression safety baseline

- Added inspectable frozen inputs and expected outputs for AAPL, JPM, WMT, CAT, RIVN, and BRK-B.
- Covered profitable technology, banking, retail, capital-intensive, loss-making, and unusual-share-structure cases.
- Made regression comparisons tolerance-based and disabled external access during financial replay.
- Corrected a test-only Windows line-ending defect before architectural work began.

### Phase 1: lazy research loading

- Removed the automatic full-analysis warm after a cold Overview.
- Kept Overview limited to normalized financials and the delayed quote.
- Deferred estimates, comps, news, filings, and risks until the corresponding section is opened.

This is the historical Phase 1 result. The current behavior amendment above restores protected background warming without making Overview wait.

### Phase 2: scaling protection

- Added same-isolate promise sharing and D1-backed cross-isolate cold-build leases/results.
- Added bounded follower waits and retryable busy responses instead of duplicate provider work.
- Centralized SEC pacing at no more than eight starts per second with a bounded queue.
- Added general, manual-refresh, and cold-build limits using trusted hashed client identity.

### Phase 3: cache and D1 efficiency

- Added safe anonymous analysis and price-history edge caching with normalized keys, ETags, refresh purges, and stale-response exclusion.
- Sampled ordinary hit telemetry at 1 in 64 while retaining weighted estimates.
- Aggregated company views and throttled refresh-due queries.
- Added immutable browser caching for fingerprinted static assets.

### Phase 4: repository consolidation

- Confirmed `sites-app/` as production and `frontend/` as shared production source.
- Removed the unused 26-file Python backend, PostgreSQL compose file, and obsolete root environment instructions.
- Replaced generic starter documentation and made the standalone frontend API proxy opt-in.

### Phase 5: frontend decomposition

- Reduced `ResearchTerminal.tsx` from 1,176 lines to 125 lines.
- Extracted company analysis, security search, theme, shell, navigation, header, and page-rendering responsibilities.
- Added focused pure search tests and a functioning ESLint 9 configuration.

### Phase 6: core analysis decomposition

- Split server domain contracts, bundled fallbacks, financial calculations, SEC access, Nasdaq access, peer data, and orchestration into focused modules.
- Preserved the public analysis surface and model versions.
- Kept all valuation and scoring logic deterministic and replayable from normalized inputs.

### Phase 7: cache and database decomposition

- Replaced one broad cache implementation with focused database, snapshot, hot-cache, normalized-source, component, refresh, telemetry, and policy modules.
- Preserved TTLs, version compatibility, stale boundaries, lease semantics, and failure behavior.
- Added exact boundary, eviction, compatibility, and lease tests.

### Phase 8: provider and error isolation

- Centralized provider transport, timeout handling, typed failures, request IDs, and structured internal logging.
- Separated SEC, Nasdaq, Yahoo Finance, and Google News clients from domain parsing.
- Added safe public error categories without leaking upstream details.
- Preserved independent optional-provider degradation and zero automatic retries by default.

### Phase 9: final engineering cleanup

- Added a clean TypeScript gate and a straightforward GitHub Actions workflow using locked dependencies.
- Added current architecture and operations documentation, including providers, caching, D1, environment variables, rate limits, deployment, and limitations.
- Updated the Sites/Vite/Cloudflare/React toolchain within existing major versions and removed all production dependency findings.
- Split the former 1,905-line mixed test file into six concern-focused suites. The largest hosted test file is now 411 lines.
- Added `test:unit`, `test:integration`, `test:api`, and `test:performance` scripts while retaining one complete `npm test` gate.
- Replaced source-string checks for response security and valuation request validation with behavior exercised through the compiled Worker.
- Removed the unused starter ChatGPT-auth helper, empty Sites Next configuration, unused Tailwind/PostCSS configuration and dependencies, an unused market-data wrapper, internal-only exports, and obsolete starter comments.
- Verified that no generated build/cache artifacts are tracked and that active documentation contains no stale starter instructions or broken local links.

## 3. Final validation status

### Production Sites application

| Check | Result |
| --- | --- |
| Clean locked install with `npm ci` | Passed |
| TypeScript with strict unused-local and unused-parameter checks | Passed |
| ESLint | Passed |
| Vinext production build | Passed |
| Unit suite | 36 passed, 0 failed |
| Integration suite | 40 passed, 0 failed |
| API suite | 9 passed, 0 failed |
| Performance suite | 10 passed, 0 failed |
| Total hosted tests | 95 passed, 0 failed |
| Frozen financial fixtures | All six representative companies passed |

### Shared frontend

| Check | Result |
| --- | --- |
| ESLint | Passed |
| Tests | 13 passed, 0 failed |
| TypeScript | Passed |
| Next.js production build | Passed |

### Repository checks

| Check | Result |
| --- | --- |
| Documentation links | Passed |
| Stale starter-instruction scan | Passed |
| Tracked generated-artifact scan | Passed |
| Diff whitespace check | Passed |

Browser interaction and visual-regression testing were not run because this phase changed engineering structure, tests, documentation, and dependencies rather than the interface, and browser QA was not requested.

## 4. Dependency and security audit

- `sites-app` production dependencies: zero known vulnerabilities.
- `frontend` complete and production dependencies: zero known vulnerabilities.
- `sites-app` complete tree: four moderate development-only advisories, with zero high or critical advisories.
- The four residual reports are the same Drizzle Kit chain: `drizzle-kit@0.31.10` -> deprecated `@esbuild-kit` loader utilities -> an older `esbuild`.
- The registry offers no compatible current-version repair. The automated forced repair proposes the breaking downgrade `drizzle-kit@0.18.1`; it was intentionally rejected.
- Drizzle Kit is used locally for migration generation and is not shipped as a production dependency or exposed as a service.

Security improvements across the refactor include trusted edge identity stamping, D1-backed abuse limits, SEC pacing, bounded request bodies, safe provider errors, security headers, cache eligibility checks, and a production dependency tree with no reported advisories.

## 5. Performance and scalability changes

- Overview returns before expensive research, then schedules a protected full warm in the background.
- Lazy section loading remains the fallback if warming has not completed.
- Same-location edge hits bypass Vinext, D1, caches, and providers.
- The hot analysis cache is bounded to 64 entries with a 30-second lifetime.
- Same-ticker cold requests share work within and across Worker isolates.
- Cross-isolate followers use short-lived shared results and bounded waits.
- SEC starts are paced across instances through D1 when available.
- Ordinary cache-hit telemetry is sampled; view writes are aggregated; refresh-due checks are throttled.
- Popular-company refreshes and cleanup run through scheduled maintenance with leases.
- Rate limits protect general traffic, manual refresh, and expensive cold builds.
- The UI terminal was decomposed without increasing the original JavaScript or stylesheet performance budgets.

## 6. Remaining technical debt

- Four moderate development-only Drizzle Kit advisories remain until its dependency chain is fixed upstream or the migration tool is deliberately replaced.
- `analysis-service.ts`, `sec-normalizer.ts`, and `ResearchPages.tsx` remain substantial modules. They are cohesive enough to retain, but future feature growth should avoid turning them into new monoliths.
- Some UI layout and architectural wiring checks still inspect source/CSS because there is no component-browser test harness. Two practical API/security cases now use compiled-Worker behavior, but a future visual-regression layer would reduce the remaining source contracts.
- The two-package shared-source boundary requires small Sites-side alias adapters such as `sites-app/lib/logo.ts`; this is documented but adds maintenance overhead.
- SEC taxonomies and filing structures vary, and public Nasdaq, Yahoo Finance, and Google News endpoints do not provide an application-owned availability guarantee.
- Bundled complete financial fallbacks cover only AAPL, NVDA, and COST and are intentionally dated.
- Peer selection is evidence-backed and explainable but remains heuristic for diversified-company segment exposure.
- The AI Research page remains a disabled preview without an LLM provider or filing citation index.
- The refactor is validated locally but has not been committed, deployed, or verified against a new live Sites version.

## 7. User-visible behavior changes

- Overview remains the highest-priority response, while protected background warming reduces later section wait time.
- Selecting a different company always opens its Overview instead of preserving the previous company's active page.
- Phase 2 adds explicit `429` and retryable `503` responses under abusive or saturated traffic.
- Phase 3 improves eligible repeated-request latency through edge caching and exposes technical cache status headers.
- Phase 8 makes required-provider and invalid-request failures safer and more accurately classified.
- No intentional visual redesign, navigation removal, financial display change, or normal successful API payload change was made.

Phase 9 itself changes no intended user-facing behavior.

## 8. Financial-model changes

No valuation formula, assumption default, DCF method, peer-multiple method, normalized valuation, growth adjustment, score weight, margin-of-safety rule, Buy Target rule, or model version was intentionally changed during the refactor.

The six frozen company outputs continue to match their Phase 0 expectations within the established numerical tolerances. Phase 9's nullable-value type cleanup preserves the existing runtime treatment of a missing market capitalization; it does not change a calculated result.

## 9. Critical ratings

| Area | Rating | Rationale |
| --- | ---: | --- |
| Architecture | 8.8/10 | Clear production ownership and strong domain/cache/provider layers; the shared two-package boundary still adds adapter complexity. |
| Maintainability | 8.5/10 | Major monoliths were decomposed and policies centralized; several cohesive but large modules remain. |
| Readability | 8.4/10 | Responsibilities and naming are substantially clearer; financial normalization and research-page rendering are still dense. |
| Testing | 8.8/10 | Frozen financials, 95 hosted tests, 13 frontend tests, API, cache, provider, and performance coverage; no browser visual-regression layer. |
| Type safety | 8.6/10 | Strict project type-check and unused-symbol checks pass; JavaScript test files and framework compatibility declarations reduce the ceiling. |
| Performance | 8.7/10 | Lazy sections, edge caching, hot caching, and reduced D1 writes address the important request paths; live regional behavior still needs post-deployment observation. |
| Scalability | 8.8/10 | Cross-isolate single-flight, D1 limits, paced SEC access, and scheduled warming are strong; D1 outage fallback is isolate-local by design. |
| Caching | 9.0/10 | Versioned snapshots, component caches, stale handling, edge cache, leases, telemetry, and bounded memory form a mature layered design. |
| Provider isolation | 8.9/10 | Transport and domain parsing are separated with independent degradation; upstream public endpoints remain operational dependencies. |
| Error handling | 8.8/10 | Safe typed categories, retry guidance, stale fallback, and non-authoritative cache writes are well covered. |
| Security hygiene | 8.5/10 | Production audit is clean and request/security controls are strong; four moderate dev-tool advisories remain. |
| Documentation | 9.0/10 | Architecture, operations, phases, environment, deployment, rate limits, limitations, and validation are documented and link-checked. |
| Repository organization | 8.7/10 | Legacy runtime removed, tests split, CI added, and ownership is clear; shared-source adapters and historical reports add intentional complexity. |

Overall, the repository is in strong engineering condition for a validated refactor branch, but it is not yet a verified production release. The next step is a deliberate review/commit and, only with explicit approval, deployment plus live smoke testing.
