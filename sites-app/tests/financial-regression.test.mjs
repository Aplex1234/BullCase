import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { buildAnalysis } from "../lib/server/analysis.ts";

const fixtureRoot = new URL("./fixtures/financial-baseline/", import.meta.url);
const inputsDirectory = new URL("inputs/", fixtureRoot);
const expectedDirectory = new URL("expected/", fixtureRoot);

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

function compareWithTolerance(actual, expected, path, absoluteTolerance, relativeTolerance) {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", `${path} must remain numeric`);
    const tolerance = Math.max(absoluteTolerance, Math.abs(expected) * relativeTolerance);
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `${path} changed from ${expected} to ${actual}; tolerance ${tolerance}`,
    );
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} must remain an array`);
    assert.equal(actual.length, expected.length, `${path} length changed`);
    expected.forEach((item, index) => compareWithTolerance(actual[index], item, `${path}[${index}]`, absoluteTolerance, relativeTolerance));
    return;
  }
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `${path} must remain an object`);
    for (const [key, value] of Object.entries(expected)) {
      compareWithTolerance(actual[key], value, `${path}.${key}`, absoluteTolerance, relativeTolerance);
    }
    return;
  }
  assert.equal(actual, expected, `${path} changed`);
}

const fixtureFiles = (await readdir(inputsDirectory)).filter((file) => file.endsWith(".json")).sort();

for (const file of fixtureFiles) {
  const input = JSON.parse(await readFile(new URL(file, inputsDirectory), "utf8"));
  const expected = JSON.parse(await readFile(new URL(file, expectedDirectory), "utf8"));

  test(`preserves frozen financial outputs for ${input.ticker} (${input.category})`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error(`Unexpected external request while running frozen fixture ${input.ticker}`);
    };
    try {
      if (expected.expected_error) {
        await assert.rejects(
          () => buildAnalysis(input.ticker, input.assumptions, input.sources),
          (error) => {
            assert.equal(error?.code, expected.expected_error.code);
            assert.equal(error?.status, expected.expected_error.status);
            assert.equal(error?.message, expected.expected_error.message);
            return true;
          },
        );
        return;
      }
      const analysis = await buildAnalysis(input.ticker, input.assumptions, input.sources);
      compareWithTolerance(
        selectFinancialOutputs(analysis),
        expected.outputs,
        input.ticker,
        expected.absolute_tolerance,
        expected.relative_tolerance,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("financial regression fixtures cover the required representative company mix", () => {
  assert.ok(fixtureFiles.length >= 6, "Expected at least six frozen financial fixtures");
});
