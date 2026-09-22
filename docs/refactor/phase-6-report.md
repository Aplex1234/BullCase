# Phase 6 report: core analysis refactor

## Scope

- Branch: `refactor/phase-0-1-baseline-lazy-warm`
- Phase 6 reorganized the core server analysis code without intentionally changing financial behavior.
- The frozen Phase 0 fixtures were run before the refactor, after every meaningful extraction, and in the final complete suite.
- No UI, cache policy, database schema, provider formula, valuation formula, scoring weight, peer-selection rule, or model version was intentionally changed.
- Production was not published during this phase.
- Phase 7 was not started.

## Architecture before

`lib/server/analysis.ts` was 1,401 lines and 63,563 bytes. It combined:

- public domain types;
- bundled fallback financial snapshots;
- financial metrics and growth calculations;
- DCF, reverse DCF, peer-multiple valuation, and valuation blending;
- eight-category scoring and buy-target margin-of-safety logic;
- SEC filing document access, filing-risk extraction, financial fingerprints, and normalized financial-source assembly;
- Nasdaq company profiles, analyst estimates, stock-universe loading, and delayed quotes;
- reviewed peer seeds, candidate shortlisting, enrichment, filtering, and comparable-company assembly;
- final source fallback, risk fallback, provenance, and response orchestration.

The broad public API was useful to callers, but the implementation mixed pure calculations, provider I/O, caches, fixtures, peer selection, and orchestration in one file.

## Architecture after

| Module | Responsibility | Lines | Bytes |
| --- | --- | ---: | ---: |
| `analysis.ts` | Public compatibility exports, source fallback decisions, calculation sequencing, risk fallback, provenance, and final response assembly | 202 | 7,564 |
| `analysis-types.ts` | Shared server-domain contracts for sources, financials, quotes, peers, filings, estimates, and assumptions | 156 | 3,507 |
| `fallback-data.ts` | Bundled SEC-derived AAPL, NVDA, and COST fallback periods and dated prices | 130 | 4,576 |
| `financial-model.ts` | Pure metrics, DCF/reverse DCF, blended valuation, scoring, and buy-target calculations | 231 | 12,345 |
| `nasdaq-provider.ts` | Nasdaq profiles, analyst estimates, stock-universe persistence, screener compaction, popular tickers, and delayed quotes | 251 | 10,977 |
| `sec-provider.ts` | SEC submissions/company facts, annual/quarterly normalization, filing document cache, filing risks, and source fingerprints | 200 | 9,485 |
| `peer-data.ts` | Reviewed peer evidence, industry shortlist, profile enrichment, relevance floor, issuer deduplication, and peer metrics | 331 | 16,205 |

`analysis.ts` decreased from 1,401 to 202 lines, an 85.6% reduction. Its byte size decreased by 88.1%. The total split source is slightly larger because each module has explicit imports, exports, and ownership boundaries.

The original `analysis.ts` remains the compatibility entry point. Existing callers continue importing `buildAnalysis`, provider functions, peer functions, screener helpers, and public types from the same path.

## Responsibilities moved

### Pure financial domain

`financial-model.ts` now contains the deterministic calculation path:

- year-over-year growth and CAGR;
- margins, ROIC, ROE, leverage, cash conversion, share change, market capitalization, and valuation multiples;
- DCF and reverse DCF;
- positive-earnings safeguards and peer-multiple valuation;
- PEG-based valuation score and the eight weighted scoring categories;
- dynamic margin-of-safety and buy-target calculation.

The formulas and evaluation order were moved verbatim. No constants, thresholds, weights, rounding rules, or model versions changed.

### Provider access

- `sec-provider.ts` owns SEC access and filing-derived data.
- `nasdaq-provider.ts` owns Nasdaq access and reference-data persistence.
- Provider-specific in-memory caches and source-version constants moved with their provider functions.
- SEC pacing remains in the existing `scaling-protection.ts`; D1/reference caching remains in the existing cache modules.

### Peer data

`peer-data.ts` owns the peer pipeline from reviewed seeds through shortlist, enrichment, ranking, metric assembly, issuer deduplication, minimum relevance score, and final peer-set metadata. The existing `peer-selection.ts` scoring engine and version remain unchanged.

### Fixtures and orchestration

- `fallback-data.ts` isolates the bundled fallback snapshots from live-provider and calculation code.
- `analysis.ts` now coordinates inputs and assembles the final response, but does not implement provider parsing or financial formulas.

## Financial regression comparison

Baseline before refactoring:

- AAPL: passed
- BRK-B: passed
- CAT: passed
- JPM: passed
- RIVN: passed
- WMT: passed
- Fixture coverage check: passed

The same seven-test frozen suite passed after each of these steps:

1. type and fallback-fixture extraction;
2. pure financial-model extraction;
3. Nasdaq-provider extraction;
4. SEC-provider extraction;
5. peer-data extraction.

The final outputs were also compared directly with the saved JSON baselines. After normalizing JavaScript negative zero to JSON's equivalent zero representation, every stored headline, metric, valuation method, assumption, reverse-DCF result, growth projection, buy target, category score, weight, rating, and model version matched exactly for all six companies.

### Numerical differences

None. No frozen numerical value, string label, formula output, category score, rating, or model version changed.

## Test adaptation

One hosted source-structure assertion originally searched only `analysis.ts` for the minimum peer-quality rule. It was updated to read the complete set of core analysis modules after the peer logic moved to `peer-data.ts`. The behavioral assertion and minimum relevance rule were not weakened or removed.

## Validation

| Check | Result |
| --- | --- |
| Frozen financial fixtures before refactor | 7 passed, 0 failed |
| Frozen fixtures after every extraction | 7 passed, 0 failed on every run |
| Exact saved-output comparison | Six companies matched exactly after negative-zero normalization |
| Sites lint | Passed with no errors or warnings |
| Sites production build | Passed |
| Complete hosted, financial, cache, and scaling suite | 86 passed, 0 failed |
| Repository whitespace check | Passed; only expected Windows line-ending notices |

## Behavior changes

- Financial and numerical behavior: none.
- User-visible behavior: none.
- Provider and cache behavior: none intended; provider functions and their caches moved together.
- Developer behavior: analysis responsibilities can now be tested and changed within focused modules while `analysis.ts` preserves its existing public API.

Phase 6 is complete. Phase 7 requires separate user authorization.
