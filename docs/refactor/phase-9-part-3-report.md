# Phase 9, part 3: dependency hygiene

Checkpoint note: the remaining work recorded below was completed in `phase-9-report.md`.

Audit date: 2026-08-31

## Scope completed

- Audited the production Sites package and shared frontend package, including complete and production-only dependency trees.
- Reviewed direct dependency drift, peer requirements, installed tree problems, and available non-breaking fixes.
- Updated the Sites, Vite, Cloudflare, and React packages together within their existing major versions.
- Refreshed the lockfile, applied safe transitive audit fixes, and confirmed a clean reproducible install with `npm ci`.

Updated direct packages:

- React, React DOM, and React Server DOM Webpack: `19.2.6` to `19.2.8`.
- Vinext: `1.0.0-beta.2` to `1.0.0-beta.8`.
- Vite: `8.0.13` to `8.2.2`.
- Cloudflare Vite plugin: `1.37.1` to `1.54.2`.
- Wrangler: `4.92.0` to `4.127.1`.
- Vite RSC plugin: `0.5.26` to `0.5.34`, matching the updated Vinext peer requirement.

No major-version upgrade was applied.

## Audit results

Before the updates, `sites-app` reported 20 development-tree advisories: 1 low, 4 moderate, and 15 high. Its production dependency tree reported zero. The `frontend` complete and production trees both reported zero.

After the updates and safe transitive fixes:

- `sites-app` production dependencies: zero known vulnerabilities.
- `sites-app` complete dependency tree: four moderate advisories, zero high or critical advisories.
- `frontend` complete and production dependency trees: zero known vulnerabilities.

The four residual findings are one development-only chain:

`drizzle-kit@0.31.10` -> `@esbuild-kit/esm-loader` -> `@esbuild-kit/core-utils` -> an older `esbuild`.

The registry offers no compatible fix for the current Drizzle Kit release. `npm audit fix --force` proposes downgrading Drizzle Kit to `0.18.1`, which is a breaking change and was intentionally rejected. This CLI is used only to generate migrations locally; it is not installed as a production dependency or exposed as an application service.

## Validation

- Clean install from the updated lockfile with `npm ci`: passed.
- Production-only vulnerability audit: zero findings.
- Complete audit: four documented moderate development-only findings; zero high or critical findings.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: production build passed; 94 tests passed with zero failures.
- `git diff --check`: passed.

No user-visible behavior or financial-model output intentionally changed. Nothing was deployed or published.

## Remaining Phase 9 work

- Reorganize large or mixed test files where doing so improves maintainability without weakening edge-case coverage.
- Remove only confirmed dead code, unused exports, duplicate helpers, stale comments, obsolete generated files, and stale configuration.
- Run the final comprehensive validation matrix and produce the final Phase 9 report and ratings.
