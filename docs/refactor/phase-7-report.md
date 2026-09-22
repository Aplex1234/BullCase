# Phase 7 - Cache and database refactor

## Scope

Phase 7 refactored the oversized cache/database implementation without changing cache policy, persistence schema, financial calculations, or user-visible behavior. Phase 8 was not started.

## Architecture before

`sites-app/lib/server/analysis-cache.ts` was an 877-line module responsible for all of the following:

- D1 access and development schema bootstrapping
- company and listing identity persistence
- full-analysis snapshot compatibility, reads, and writes
- the bounded hot in-memory cache
- normalized financial-source reads, writes, and fingerprint checks
- component-cache reads and writes
- refresh leases and background scheduling
- popularity aggregation and refresh-due selection
- cache telemetry, provider failures, peer-selection audit records, pruning, and monitoring

Every consumer imported this single module directly.

## Architecture after

`analysis-cache.ts` remains the stable compatibility facade and is now 54 lines and 1,369 bytes. Existing consumers keep the same public imports.

| Module | Responsibility | Lines |
| --- | --- | ---: |
| `analysis-cache.ts` | Backward-compatible public cache API | 54 |
| `cache-policy.ts` | TTLs, lease duration, hot-cache bounds | 14 |
| `cache-database.ts` | D1 runtime access, development bootstrap, identities | 233 |
| `analysis-snapshot-cache.ts` | Versioned analysis snapshots and compatibility | 139 |
| `hot-analysis-cache.ts` | 30-second, 64-entry LRU-style hot cache | 41 |
| `financial-source-cache.ts` | Normalized SEC source cache and fingerprints | 142 |
| `component-cache.ts` | Quote, estimates, comps, risks, and news cache | 100 |
| `cache-refresh.ts` | Leases, background work, popularity, due refreshes | 130 |
| `cache-telemetry.ts` | Events, failures, peer audits, pruning, monitoring | 142 |

The compatibility entry point was reduced by 93.8 percent by line count. The total implementation is intentionally distributed across cohesive modules rather than minimized through dense code.

## Preserved semantics

- TTL values are unchanged.
- Analysis compatibility still checks the schema, normalization, valuation, score, and every component-source version.
- A cache entry becomes stale when `fresh_until` is equal to or earlier than the current time.
- Analysis refresh leases retain the two-minute timeout and strict expiry comparison.
- Shared keyed leases retain their existing D1 upsert and strict expiry comparison.
- The hot analysis cache retains a 30-second entry lifetime, case-normalized tickers, recency promotion on read, and a 64-entry bound.
- Component and normalized financial caches retain their source-version and normalization-version checks.
- Stale data, provider failure recording, company-view aggregation, due-refresh throttling, scheduled refresh behavior, and background `waitUntil` behavior are unchanged.
- The `analysis-cache.ts` import surface remains compatible for the application, worker, tests, market-data cache, reference cache, and scaling protection.

## Query and write behavior

No D1 schema or migration changed. Existing SQL statements and conflict rules were moved to focused modules without intentional changes. The refactor does not add reads, writes, transactions, cache-event records, refresh attempts, or background tasks. Phase 3 sampling and aggregated-view behavior remain intact.

## Focused tests added

`sites-app/tests/cache-refactor.test.ts` adds four focused cases:

1. Analysis compatibility accepts only the complete current version set and rejects schema, component, and malformed-version mismatches.
2. Analysis and component entries transition from fresh to stale at the exact expiry boundary, and corrupt payloads are rejected.
3. The hot cache expires at 30 seconds and evicts the least recently used entry when the 64-entry bound is exceeded.
4. Analysis and keyed refresh leases reject overlaps and become acquirable only after their strict expiry boundary.

The hosted test command now includes this file. One source-structure assertion was updated to inspect `cache-refresh.ts`, where lease behavior now lives.

## Validation

- Frozen Phase 0 financial regression: 7/7 passed before extraction, after extraction, and with the focused Phase 7 tests.
- Focused Phase 7 plus financial tests: 11/11 passed.
- Production build: passed.
- Complete hosted suite: 90/90 passed.
- ESLint: passed with no errors.
- Diff whitespace check: passed.

There is no configured `typecheck` package script. A diagnostic standalone `tsc --noEmit` run is not currently a clean project gate: the repository uses explicit `.ts` imports without enabling `allowImportingTsExtensions`. Re-running with that compiler flag isolates previously existing issues in `analysis-service.ts`, `financial-model.ts`, `peer-data.ts`, and the Cloudflare virtual-module declaration. The new Phase 7 test's strict cast was corrected; no remaining diagnostic is in newly authored Phase 7 logic. The production compiler and build pass.

## Behavior and financial output

- User-visible behavior changes: none expected or observed.
- Cache/database behavior changes: none intended; focused boundary tests confirm the preserved semantics.
- Financial-model changes: none.
- Frozen financial-output differences: none.
- Deployment or publishing: not performed.

## Stop point

Phase 7 is complete. Phase 8 has not begun and requires explicit authorization.
