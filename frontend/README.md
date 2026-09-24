# Shared BullCase interface

This directory contains the React interface and browser-side financial utilities used by the production application in `../sites-app/`.

`sites-app` imports the components, styles, types, formatting helpers, chart transforms, analysis-section merging, and client API helpers directly. This directory is therefore intentional shared production source, not an obsolete second application.

The small Next.js wrapper under `app/` remains an isolated development and validation harness. It is not the production deployment target. To connect that harness to a separately running API during local development, set `API_PROXY_URL` explicitly; otherwise no API rewrite is installed.

## Terminal architecture

- `components/ResearchTerminal.tsx` coordinates the selected ticker, active page, and the main shell.
- `hooks/useCompanyAnalysis.ts` owns overview requests, deferred-section loading, retries, and manual refresh.
- `hooks/useSecuritySearch.ts` owns debounced autocomplete, request cancellation, recent companies, selection, and prefetching.
- `components/CompanySearch.tsx`, `TerminalHeader.tsx`, `TerminalNavigation.tsx`, and `CompanyHeader.tsx` own the major shell surfaces.
- `components/ResearchPages.tsx` owns the section/page rendering while preserving the existing financial charts and research views.
- `lib/security-search.ts` contains pure recent-company and option-merging helpers.

## Checks

```text
npm run lint
npm test
npm run typecheck
npm run build
```

The production Sites regression suite also reads these sources directly, so interface changes must pass both this package's checks and `../sites-app` tests.
