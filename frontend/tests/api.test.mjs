import assert from "node:assert/strict";
import test from "node:test";

import { fetchAnalysis, warmAnalysis, searchSecurities, fetchStockPriceHistory, runValuation } from "../lib/api.ts";

for (const [label, request] of [
  ["search", () => searchSecurities("Apple")],
  ["price history", () => fetchStockPriceHistory("AAPL")],
  ["valuation", () => runValuation("AAPL", {})],
]) {
  test(`${label} ends a stalled request and aborts its transport`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let transportSignal;
    t.mock.method(globalThis, "fetch", (_url, init) => {
      transportSignal = init.signal;
      return new Promise(() => {});
    });
    let failure;
    void request().catch((error) => { failure = error; });
    t.mock.timers.tick(45_000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(failure?.message ?? "", /timed out.*retry/i);
    assert.equal(transportSignal.aborted, true);
  });
}

test("an HTML gateway error produces a useful error instead of a JSON parser message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
  await assert.rejects(searchSecurities("Apple"), /service.*retry/i);
});

test("a stalled background warm cannot block News or Peers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let releaseWarm;
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    if (!String(url).includes("?view=")) return new Promise((resolve) => { releaseWarm = resolve; });
    return new Response(JSON.stringify({ data: { data_scope: "partial" } }));
  });
  const warm = warmAnalysis("SLOW");
  const news = fetchAnalysis("SLOW", undefined, "news");
  const peers = fetchAnalysis("SLOW", undefined, "comps");
  t.mock.timers.tick(500);
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.ok(urls.some((url) => url.endsWith("?view=news")));
    assert.ok(urls.some((url) => url.endsWith("?view=comps")));
  } finally {
    releaseWarm(new Response(JSON.stringify({ data: { data_scope: "full" } })));
    await Promise.all([warm, news, peers]);
  }
});

test("stalled research requests time out with a retryable error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { release = resolve; }));
  let failure;
  const request = fetchAnalysis("TIMEOUT", undefined, "news").catch((error) => { failure = error; });
  t.mock.timers.tick(45_000);
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.match(failure?.message ?? "", /timed out.*retry/i);
  } finally {
    release(new Response(JSON.stringify({ data: {} })));
    await request;
  }
});

test("one cancelled Overview consumer does not cancel the shared company request", async () => {
  const originalFetch = globalThis.fetch;
  let releaseRequest;
  let requestCount = 0;
  globalThis.fetch = async (_input, init) => new Promise((resolve, reject) => {
    requestCount += 1;
    releaseRequest = () => resolve(new Response(JSON.stringify({
      data: { company: { ticker: "RACE" } },
    }), { headers: { "content-type": "application/json" } }));
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });

  try {
    const controller = new AbortController();
    const cancelledConsumer = fetchAnalysis("RACE", controller.signal, "overview");
    controller.abort();
    const activeConsumer = fetchAnalysis("RACE", undefined, "overview");
    releaseRequest();

    await assert.rejects(cancelledConsumer, { name: "AbortError" });
    assert.equal((await activeConsumer).company.ticker, "RACE");
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background warming and section demand share one full-analysis request", async () => {
  const originalFetch = globalThis.fetch;
  const pending = [];
  const requestedUrls = [];
  globalThis.fetch = async (input) => new Promise((resolve) => {
    requestedUrls.push(String(input));
    pending.push(() => resolve(new Response(JSON.stringify({
      data: {
        company: { ticker: "META" },
        data_scope: "full",
        loaded_sections: ["overview", "news", "comps", "valuation"],
      },
    }), { headers: { "content-type": "application/json" } })));
  });

  try {
    const warming = warmAnalysis("meta");
    const requestedSection = fetchAnalysis("META", undefined, "news");
    const requestCount = pending.length;
    pending.forEach((release) => release());
    const [warmed, section] = await Promise.all([warming, requestedSection]);

    assert.equal(requestCount, 1);
    assert.equal(requestedUrls[0], "/api/v1/companies/META/analysis");
    assert.equal(warmed.data_scope, "full");
    assert.equal(section.data_scope, "full");
  } finally {
    pending.forEach((release) => release());
    globalThis.fetch = originalFetch;
  }
});

test("section demand falls back to its focused request when full warming fails", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    if (requestedUrls.length === 1) {
      return new Response(JSON.stringify({ detail: "Full research is temporarily unavailable." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      data: {
        company: { ticker: "FALL" },
        data_scope: "partial",
        loaded_sections: ["overview", "news"],
      },
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const warming = warmAnalysis("FALL");
    const requestedSection = fetchAnalysis("FALL", undefined, "news");
    await assert.rejects(warming, /Full research is temporarily unavailable/);
    const section = await requestedSection;

    assert.equal(section.data_scope, "partial");
    assert.deepEqual(requestedUrls, [
      "/api/v1/companies/FALL/analysis",
      "/api/v1/companies/FALL/analysis?view=news",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
