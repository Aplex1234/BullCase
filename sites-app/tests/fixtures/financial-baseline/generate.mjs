import { mkdir, writeFile } from "node:fs/promises";

import { buildAnalysis } from "../../../lib/server/analysis.ts";

const productionOrigin = "https://example.com";
const fixtures = [
  { ticker: "AAPL", category: "large profitable technology" },
  { ticker: "JPM", category: "bank and financial company" },
  { ticker: "WMT", category: "retailer and consumer company" },
  { ticker: "CAT", category: "capital-intensive industrial company" },
  { ticker: "RIVN", category: "loss-making company" },
  { ticker: "BRK-B", category: "unusual share structure" },
];
const root = new URL("./", import.meta.url);
const inputsDirectory = new URL("inputs/", root);
const expectedDirectory = new URL("expected/", root);

function selectFinancialOutputs(analysis) {
  return {
    headline: analysis.headline,
    metrics: analysis.metrics,
    valuation: {
      current_price: analysis.valuation.current_price,
      bear_value: analysis.valuation.bear_value,
      base_value: analysis.valuation.base_value,
      bull_value: analysis.valuation.bull_value,
      upside_to_fair_value: analysis.valuation.upside_to_fair_value,
      methods: analysis.valuation.methods,
      earnings_multiple_status: analysis.valuation.earnings_multiple_status,
      assumptions: analysis.valuation.assumptions,
      reverse_dcf: analysis.valuation.reverse_dcf,
      growth_projection: analysis.valuation.growth_projection,
      methodology: analysis.valuation.methodology,
    },
    buy_target: analysis.buy_target,
    score: analysis.score,
    model_versions: {
      normalization: analysis.provenance.normalization_version,
      valuation: analysis.provenance.valuation_model_version,
      score: analysis.provenance.score_model_version,
    },
  };
}

function frozenSources(analysis, capturedAt) {
  const profile = { ...analysis.company };
  delete profile.ticker;
  return {
    financials: {
      profile,
      periods: analysis.financials,
      quarterlyPeriods: analysis.quarterly_financials,
      filings: analysis.filings,
      filingRisks: analysis.risks.filter((risk) => risk.kind === "filing_theme" || risk.severity === "filed"),
    },
    financialSourceMode: "frozen-provider-snapshot",
    quote: analysis.quote,
    analystEstimates: analysis.analyst_estimates,
    peerSet: {
      companies: analysis.comps,
      methodology: analysis.peer_selection.methodology,
      source_provider: analysis.peer_selection.source_provider,
      source_url: analysis.peer_selection.source_url,
      source_as_of: analysis.peer_selection.source_as_of,
      candidates_considered: analysis.peer_selection.candidates_considered,
      selection_version: analysis.peer_selection.selection_version,
    },
    newsFeed: {
      items: [],
      fetched_at: capturedAt,
      providers: [],
      industry_query: null,
      warnings: [],
    },
    warnings: [],
  };
}

await mkdir(inputsDirectory, { recursive: true });
await mkdir(expectedDirectory, { recursive: true });

for (const fixture of fixtures) {
  const capturedAt = new Date().toISOString();
  const sourceUrl = `${productionOrigin}/api/v1/companies/${fixture.ticker}/analysis`;
  const response = await fetch(sourceUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${fixture.ticker} snapshot returned ${response.status}`);
  const payload = await response.json();
  if (!payload.data || payload.data.data_scope !== "full") throw new Error(`${fixture.ticker} did not return a full analysis snapshot`);

  const input = {
    fixture_version: 1,
    ticker: fixture.ticker,
    category: fixture.category,
    captured_at: capturedAt,
    captured_from: sourceUrl,
    assumptions: null,
    sources: frozenSources(payload.data, capturedAt),
  };
  const rebuilt = await buildAnalysis(fixture.ticker, undefined, input.sources);
  const expected = {
    fixture_version: 1,
    ticker: fixture.ticker,
    captured_at: capturedAt,
    absolute_tolerance: 1e-6,
    relative_tolerance: 1e-9,
    outputs: selectFinancialOutputs(rebuilt),
  };

  await writeFile(new URL(`${fixture.ticker}.json`, inputsDirectory), `${JSON.stringify(input, null, 2)}\n`);
  await writeFile(new URL(`${fixture.ticker}.json`, expectedDirectory), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`Captured ${fixture.ticker}: ${payload.data.financials.length} annual periods, ${payload.data.comps.length} peers`);
}
