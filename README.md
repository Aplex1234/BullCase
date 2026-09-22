# AplexAnalysis

AplexAnalysis is a transparent equity-research terminal. Enter a US-listed ticker and the application retrieves SEC Company Facts, normalizes annual financial statements, calculates key metrics, runs a multi-method valuation, applies a dynamic margin of safety, and produces a reproducible 0 to 100 attractiveness score.

## Repository architecture

- `sites-app/` is the canonical full-stack application and the only production deployment target. It contains the Cloudflare Worker, API routes, D1 schema and migrations, server-side analysis engine, tests, and hosting configuration.
- `frontend/` contains the shared React interface and browser-side financial utilities used directly by `sites-app/`. It also remains an isolated UI test and type-check surface.

The production application is hosted from `sites-app/` through OpenAI Sites. Financial algorithms should not be moved between these areas without running the frozen financial regression suite.

See [`docs/architecture-and-operations.md`](docs/architecture-and-operations.md) for the production request flow, provider responsibilities, cache policy, database model, environment variables, rate limits, deployment process, and known limitations.

The original standalone Python backend was removed after its routes, fallback data, and financial functions were verified as obsolete relative to the production engine. Its history remains recoverable through Git.

## What works in this milestone

- SEC ticker resolution, Company Facts ingestion and recent 10-K, 10-Q and 8-K links
- SEC-wide ticker and company autocomplete with exchange-aware stable issuer, security and listing IDs
- Delayed quote retrieval from Nasdaq's public market activity service
- D1-backed analysis, market-data, and reference caches in the production application
- Five-year annual statement normalization with metric-level provenance
- Revenue, earnings, cash flow, margins, ROIC, ROE, leverage, dilution, buyback and valuation metrics
- Bear, Base and Bull DCF cases with editable assumptions
- Comparable, growth-adjusted and normalized-multiple valuation methods
- Reverse DCF implied growth
- Dynamic Buy Target margin of safety
- Eight-category AplexAnalysis Score with visible formulas and weights
- Professional responsive terminal with Overview, Financials, Valuation, Buy Target, Comps, Earnings, Filings, Risks and AI Research areas
- Offline SEC-derived fallback snapshots for AAPL, NVDA and COST

## Local setup

1. Use Node.js 22.13 or newer.
2. From `sites-app`, run `npm install`.
3. Run `npm run dev` and open the local address it prints.

The local application uses the same Vinext routes and Worker structure as production. The D1 binding is simulated locally from the declaration in `sites-app/.openai/hosting.json`.

The shared UI can be checked independently from `frontend` with `npm test`, `npm run typecheck`, and `npm run build`.

## Accuracy and provenance

SEC values are selected from annual 10-K facts, de-duplicated by fiscal year, and retain taxonomy tag, filing date, accession number and source URL. Free cash flow and diluted EPS are derived with explicit formulas. If live SEC or delayed quote retrieval fails, the app clearly labels and dates its fallback snapshots.

Comparable companies are selected dynamically from reviewed relationships, Nasdaq candidates, company descriptions, filing context, business-model overlap, and size relevance. Every selected peer carries its score factors and evidence metadata. The relevance floor permits fewer peers rather than padding the result with unrelated companies.

## Methodology

The blended fair value is 55% DCF, 20% peer P/E, 15% growth-adjusted P/E and 10% normalized P/E. The score weights are valuation 30%, quality 20%, growth 15%, financial strength 10%, capital allocation 10%, earnings quality 5%, momentum 5% and risk 5%.

AI research is scaffolded but intentionally disabled until a provider and filing citation index are configured. No LLM is used for numerical scores or valuation outputs.

## Tests

From `sites-app`, run `npm run typecheck`, `npm run lint`, and `npm test`. The test command runs the production build before the hosted regression suite, including frozen representative-company financial outputs. From `frontend`, run `npm run lint`, `npm test`, `npm run typecheck`, and `npm run build` for the shared interface and browser-side financial utilities.

## Disclaimer

This software is for research and education. It is not investment advice. Verify source filings and assumptions before making financial decisions.
