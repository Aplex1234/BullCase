# Phase 4 report: repository consolidation

## Scope

- Branch: `refactor/phase-0-1-baseline-lazy-warm`
- Production was not published during this phase.
- Phase 5 was not started.
- No financial algorithm, formula, model version, UI behavior, or production API payload was changed.

## Architecture before

| Area | Previous role | Problem |
| --- | --- | --- |
| `sites-app/` | Actual production Vinext, Cloudflare Worker, D1, API, and analysis runtime | Still carried a generic starter README. |
| `frontend/` | Shared production UI and browser utilities, plus a standalone Next.js validation harness | Its production relationship was undocumented, and its development proxy still defaulted to the obsolete Python service. |
| `backend/` | Original FastAPI, SQLAlchemy, and Python financial implementation | Not imported, packaged, deployed, or tested by the production Sites path, but still appeared canonical in root setup instructions. |
| Root configuration | Mixed current and legacy instructions | `.env.example` and `docker-compose.yml` described the unused Python/PostgreSQL stack. |

## Evidence used to determine ownership

- `sites-app/.openai/hosting.json` is the only deployment declaration and owns the production project ID and D1 binding.
- `sites-app/worker/index.ts` is the deployed Worker entry point and routes requests into Vinext and the same-origin API.
- Production API routes, SEC and market retrieval, D1 caching, normalization, valuation, scoring, and regression tests all live in `sites-app`.
- `sites-app/app/page.tsx`, its stylesheets, utility facades, and hosted tests directly import `frontend` components and utilities. `frontend` is therefore intentional shared production code.
- No `sites-app` or `frontend` production source imported the Python backend.
- The Python backend was internally self-contained and had no deployment metadata.
- Its search, analysis, and valuation routes have production equivalents. Its methodology endpoint repeated model weights already returned by production, and its research endpoint was only a `501 Not Implemented` scaffold.
- Its AAPL, NVDA, and COST fallback snapshots and peer references are represented in the production engine, which now has broader filing, quarterly, cache, price-history, and peer-selection behavior.

## Architecture after

| Area | Canonical role |
| --- | --- |
| `sites-app/` | Full-stack production runtime, deployment target, server engine, D1 schema and migrations, and hosted regression suite. |
| `frontend/` | Intentional shared production UI and browser utilities, with a small isolated Next.js validation harness. |
| Root | Project-level documentation, historical reports, and repository-wide ignore rules only. |

The two-package boundary is intentionally retained. Moving the large shared frontend immediately before the dedicated frontend-refactor phase would create high-churn path changes without improving runtime behavior. Its relationship is now documented at the root and in both packages.

## Files and directories removed

- Removed `backend/`: 26 tracked files and 1,648 lines covering FastAPI routes, SQLAlchemy models, Python providers and financial services, fallback data, dependency manifests, and tests.
- Removed root `docker-compose.yml`, which existed only for the backend PostgreSQL development service.
- Removed the root `.env.example`, whose database, CORS, API-proxy, and unused AI-provider entries described the legacy architecture.
- Removed Python-only ignore rules from the root `.gitignore`.
- Removed the invalid frontend `next lint` script, which Next.js 16 no longer supports and which never reached a linter.

All deleted tracked content remains recoverable through Git history.

## Documentation and configuration changes

- Updated the root README with the canonical architecture, Sites-first local setup, and current validation commands.
- Replaced the generic `sites-app` starter README with BullCase-specific architecture, development, validation, migration, and deployment guidance.
- Added `frontend/README.md` to document its shared production role and isolated harness.
- Added and unignored `sites-app/.env.example` containing only the two variables used by the current application.
- Changed the standalone frontend harness so it installs an API rewrite only when `API_PROXY_URL` is explicitly set. It no longer silently targets a deleted service.
- Added a Phase 4 note to the historical security report so its former FastAPI findings are not mistaken for the current architecture.

## Path and import changes

- No production source import was moved or renamed.
- Direct `sites-app` imports from `frontend` remain unchanged and were verified by the hosted build and tests.
- The only runtime-configuration change is in the standalone frontend harness: `API_PROXY_URL` is now opt-in instead of defaulting to `http://127.0.0.1:8000`.

## Behavior changes

- Production behavior: none.
- Financial and user-facing behavior: none.
- Development behavior: the obsolete Python API can no longer be started; the standalone frontend harness requires an explicit API origin to proxy API calls.

## Validation

| Check | Result |
| --- | --- |
| Sites lint | Passed |
| Sites production build | Passed |
| Hosted and frozen financial regression suite | 86 passed, 0 failed |
| Shared frontend tests | 10 passed, 0 failed |
| Shared frontend type-check | Passed |
| Shared frontend production build | Passed |
| Repository diff whitespace check | Passed; Git reported only expected Windows line-ending notices |
| Legacy path/reference audit | No active production or setup reference remains; historical reports are explicitly historical |

## Deliberately retained structure

- `frontend/` remains separate because production consumes it and Phase 5 is dedicated to refactoring its oversized components and responsibilities.
- Separate package manifests remain so the shared UI can be independently type-checked and built while the hosted app retains its Cloudflare/Vinext toolchain.
- Historical Phase 0-3, performance, and security reports remain for auditability even where they describe earlier repository states.

Phase 4 is complete. Phase 5 requires separate user authorization.
