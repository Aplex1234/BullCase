# Phase 9, part 1: validation foundation

Checkpoint note: the remaining work recorded below was completed in `phase-9-report.md`.

## Scope completed

- Added a first-class TypeScript validation command.
- Cleared the existing TypeScript diagnostics with mechanical fixes only.
- Added a GitHub Actions workflow that installs locked dependencies, type-checks, lints, builds, and runs the full test suite.
- Updated the application README with the local and CI validation commands.

The type fixes do not intentionally change financial calculations, provider selection, cache policy, or public API behavior. The peer-data import restores the already-intended direct quote-loading path.

## Validation

Validated from `sites-app/`:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: production build passed; 94 tests passed with zero failures.
- `git diff --check`: passed.

## Remaining Phase 9 work

- Reorganize large or mixed test files where doing so improves maintainability without weakening edge-case coverage.
- Remove confirmed dead code, unused exports, duplicate helpers, stale comments, obsolete generated files, and stale configuration.
- Run the final comprehensive validation matrix and produce the final Phase 9 report and ratings.
