# Phase 0 and Phase 1 report

## Scope

- Branch: `refactor/phase-0-1-baseline-lazy-warm`
- Production runtime: `sites-app/`, a Vinext/React Cloudflare Sites application with D1-backed caches
- Shared UI: production imports code from `frontend/`
- Legacy reference implementation: `backend/` is not used by the hosted runtime
- Production was not published during this phase

## Pre-change safety baseline

The initial checkout was clean at commit `18907242043e41562e3e3b225e82278d91610c1f`.

| Check | Pre-change result |
| --- | --- |
| Hosted production build | Passed |
| Hosted regression suite | 67 passed, 1 failed |
| Hosted lint | Passed |
| Shared frontend tests | 10 passed |
| Shared frontend typecheck | Passed |
| Shared frontend build | Passed |
| Shared frontend lint script | Failed before linting because Next.js 16 no longer supports `next lint` |

The one hosted regression failure was a test-only Windows portability defect: a source-extraction expression required LF line endings even though the checkout uses CRLF. Phase 0 made that expression line-ending independent. No production behavior changed as part of that correction.

The legacy Python backend was also checked after the production validation. Its tests cannot collect in the current environment because its optional Python dependencies are not installed. It is not part of the production Sites runtime and was not modified.

## Frozen financial baseline

The checked-in fixture set was captured from the public production application before the Phase 1 change. Each `inputs/` file contains provider-derived normalized financials, quote data, estimates, peer inputs, and filing metadata. Each matching `expected/` file contains the calculated financial outputs.

| Ticker | Representative case | Fair value | Buy target | Bear | Base | Bull | Score | DCF |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AAPL | Large profitable technology | 221.17 | 195.80 | 72.14 | 221.17 | 221.17 | 55 | 130.01 |
| JPM | Bank and financial company | 291.85 | 263.79 | 164.69 | 291.85 | 291.85 | 52 | 211.14 |
| WMT | Retailer and consumer company | 50.96 | 44.89 | 14.61 | 50.96 | 50.96 | 33 | 28.58 |
| CAT | Capital-intensive industrial company | 391.39 | 318.49 | 146.90 | 391.39 | 548.71 | 41 | 305.00 |
| RIVN | Loss-making company | 2.45 | 1.97 | 1.88 | 2.45 | 3.33 | 21 | 2.45 |
| BRK-B | Unusual share structure | 366.34 | 336.99 | 122.85 | 366.34 | 366.34 | 34 | 199.33 |

The expected files also preserve comparable-company, growth-adjusted, and normalized valuation methods; important calculated metrics; score categories; model versions; assumptions; and margin-of-safety components. RIVN correctly records the earnings-based methods as unavailable because trailing earnings are negative.

Regression execution disables external network access and rebuilds every result from frozen inputs. Floating-point values use an absolute tolerance of `1e-6` and a relative tolerance of `1e-9`.

## Phase 1 behavior

### Before

1. A cold `view=overview` request built the lightweight Overview response.
2. Immediately afterward, the route scheduled `warmFullAnalysis` in the background.
3. That background task rebuilt the full analysis, including estimates, comparable-company enrichment, news, and filing risks even if the user never opened those sections.

### After

1. A cold `view=overview` request loads only the normalized financial data and delayed quote needed by Overview.
2. The response returns without scheduling a full analysis.
3. Financials, valuation, buy target, earnings, comps, news, filings, and risks continue to load through their existing direct section requests.
4. Cached Overview responses and scheduled lightweight popularity refreshes retain their existing behavior.

The only expected user-visible tradeoff is that the first opening of an expensive section may take longer because it is no longer preloaded for users who only viewed Overview.

## Final validation

| Check | Result |
| --- | --- |
| Hosted production build | Passed |
| Hosted regression and financial baseline suites | 76 passed, 0 failed |
| Hosted lint | Passed |
| Shared frontend tests | 10 passed, 0 failed |
| Shared frontend typecheck | Passed |
| Shared frontend production build | Passed |
| Shared frontend lint script | Still blocked by its pre-existing obsolete `next lint` command |

No financial formula, assumption, score, valuation, buy target, or expected numerical output changed. No UI layout or copy changed. The only production behavior change is deferred loading of expensive research sections after a cold Overview.

Phase 2 has not started and requires explicit authorization.
