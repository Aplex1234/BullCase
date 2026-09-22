# Phase 5 report: frontend refactor

## Scope

- Branch: `refactor/phase-0-1-baseline-lazy-warm`
- Phase 5 refactored the shared production frontend, primarily the oversized `ResearchTerminal.tsx`.
- Production was not published during this phase.
- Phase 6 was not started.
- No financial formula, scoring model, peer-selection model, API payload, chart calculation, or user-visible design was intentionally changed.

## Responsibilities before

The previous `ResearchTerminal.tsx` was a 1,176-line component responsible for all of the following:

- selected ticker and active-page state;
- overview loading, request cancellation, retry, and error state;
- deferred-section loading, merging, and section-level errors;
- manual refresh state and freshness messages;
- debounced autocomplete, request cancellation, keyboard selection, and menu state;
- recent-company persistence and option merging;
- analysis prefetching and company navigation;
- theme persistence and theme switching;
- the application header, search UI, navigation, company header, loading shell, and error shell;
- all ten research-page render branches and their page-specific markup.

This made unrelated behavior difficult to test independently and required hosted regression tests to inspect a single very large source file.

## Responsibilities after

| File | Responsibility | Lines | Bytes |
| --- | --- | ---: | ---: |
| `components/ResearchTerminal.tsx` | Coordinates ticker, active page, extracted hooks, shell components, loading/error state, and page rendering | 125 | 4,357 |
| `components/ResearchPages.tsx` | Preserved rendering for all research sections and page-specific views | 591 | 38,610 |
| `hooks/useCompanyAnalysis.ts` | Overview loading, cancellation, deferred loading, section merging, retry, and manual refresh | 175 | 6,016 |
| `hooks/useSecuritySearch.ts` | Autocomplete state, 250 ms debounce, cancellation, recent companies, selection, and prefetch | 146 | 4,196 |
| `components/CompanySearch.tsx` | Search field, keyboard controls, autocomplete/recent menu, and accessible combobox markup | 119 | 5,349 |
| `components/CompanyHeader.tsx` | Company identity, quote, provenance, freshness, and refresh controls | 110 | 4,739 |
| `components/TerminalNavigation.tsx` | Ten-section terminal navigation and mobile/short-screen hints | 68 | 2,535 |
| `components/TerminalHeader.tsx` | Brand, search placement, coverage indicator, and theme control | 42 | 1,286 |
| `hooks/useTerminalTheme.ts` | Theme persistence and switching | 26 | 694 |
| `lib/security-search.ts` | Pure recent-company parsing, ordering, bounding, and option merging | 40 | 1,327 |

The top-level terminal decreased from 1,176 to 125 lines, an 89.4% reduction. The extracted source is intentionally grouped into a small number of coherent hooks and components rather than many tiny files.

The production `sites-app` retains its established adapter boundary. Three small hook adapters and one search-helper adapter allow the same shared frontend source to resolve correctly in both the standalone Next.js harness and the Vinext/Cloudflare production build.

## Behavior preserved

- Overview requests still use cancellation and ignore obsolete responses.
- Security search still waits 250 ms, cancels obsolete requests, and keeps the current ticker from issuing redundant searches.
- Analysis request deduplication remains in the existing API helper.
- Search selection and pointer hover still prefetch analysis where useful.
- Recent companies remain unique, newest first, and limited to five.
- Deferred research sections still load only when visited and merge without erasing previously loaded data or freshness.
- Section-level failures remain scoped to the affected page and retain retry behavior.
- Manual refresh still bypasses the relevant cache and merges only the requested section when appropriate.
- Search keyboard navigation, Escape behavior, focus behavior, company navigation, charts, page navigation, loading states, warnings, and theme persistence remain intact.

## Test and validation changes

- Added pure tests for corrupt/valid recent-company storage, unique bounded ordering, and live-result/recent-result merging.
- Updated hosted source assertions to read the extracted terminal modules rather than assuming every responsibility remains in `ResearchTerminal.tsx`.
- Added a supported ESLint 9 flat configuration to replace the obsolete `next lint` command and make frontend linting independently runnable.
- Kept the intentional effect-driven request/storage resets and native multi-provider logo fallback documented in the lint configuration.
- Added production adapters for the extracted hooks and search helper.

## Validation

| Check | Result |
| --- | --- |
| Shared frontend lint | Passed with no errors or warnings |
| Shared frontend tests | 13 passed, 0 failed |
| Shared frontend type-check | Passed |
| Shared frontend production build | Passed |
| Sites lint | Passed with no errors or warnings |
| Sites production build | Passed |
| Hosted, frozen-financial, cache, and scaling regression suite | 86 passed, 0 failed |
| Repository diff whitespace check | Passed; Git reported only expected Windows line-ending notices |

## Behavior changes

- User-visible and financial behavior: none intended or observed in the automated regression coverage.
- Developer behavior: the frontend now has a functioning standalone lint command.
- Internal architecture: responsibilities are separated into focused hooks, shell components, page rendering, and pure search helpers.

Phase 5 is complete. Phase 6 requires separate user authorization.
