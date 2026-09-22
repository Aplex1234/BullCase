import assert from "node:assert/strict";
import test from "node:test";
import {
  cacheEventSampleWeight,
  claimThrottledWork,
  takeAggregatedViewDelta,
  type AggregatedViewState,
} from "../lib/server/cache-efficiency.ts";
import {
  EDGE_CACHEABLE_HEADER,
  analysisEdgeCacheKeys,
  edgeCacheKey,
  edgeCachePolicy,
  isEdgeCacheableResponse,
  matchEdgeApiResponse,
  prepareEdgeCachedResponse,
  type EdgeCacheLike,
} from "../lib/server/edge-cache.ts";

class MemoryEdgeCache implements EdgeCacheLike {
  private readonly entries = new Map<string, Response>();

  async match(request: Request) {
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response) {
    this.entries.set(request.url, response.clone());
  }

  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
}

test("samples ordinary cache hits while retaining weighted monitoring counts", () => {
  assert.equal(cacheEventSampleWeight("hit", 0), 64);
  assert.equal(cacheEventSampleWeight("hit", 0.5), 0);
  assert.equal(cacheEventSampleWeight("miss", 0.999), 1);
  assert.equal(cacheEventSampleWeight("stale", 0.999), 1);
});

test("aggregates company views and throttles refresh-due checks", () => {
  const views: AggregatedViewState = new Map();
  assert.equal(takeAggregatedViewDelta(views, "listing:aapl", 0, 60_000), 1);
  assert.equal(takeAggregatedViewDelta(views, "listing:aapl", 1_000, 60_000), 0);
  assert.equal(takeAggregatedViewDelta(views, "listing:aapl", 59_999, 60_000), 0);
  assert.equal(takeAggregatedViewDelta(views, "listing:aapl", 60_000, 60_000), 3);

  const work = new Map<string, number>();
  assert.equal(claimThrottledWork(work, "refresh", 0, 300_000), true);
  assert.equal(claimThrottledWork(work, "refresh", 299_999, 300_000), false);
  assert.equal(claimThrottledWork(work, "refresh", 300_000, 300_000), true);
});

test("edge policy caches only anonymous safe analysis and price-history GETs", () => {
  assert.deepEqual(edgeCachePolicy(new Request("https://example.test/api/v1/companies/AAPL/analysis?view=overview")), { kind: "analysis" });
  assert.deepEqual(edgeCachePolicy(new Request("https://example.test/api/v1/companies/AAPL/price-history?range=1y")), { kind: "price-history" });
  assert.equal(edgeCachePolicy(new Request("https://example.test/api/v1/companies/AAPL/analysis", { method: "POST" })), null);
  assert.equal(edgeCachePolicy(new Request("https://example.test/api/v1/companies/AAPL/analysis?refresh=1")), null);
  assert.equal(edgeCachePolicy(new Request("https://example.test/api/v1/companies/AAPL/analysis?view=unknown")), null);
  assert.equal(edgeCachePolicy(new Request("https://example.test/api/v1/companies/AAPL/analysis", { headers: { cookie: "session=1" } })), null);
  assert.equal(edgeCachePolicy(new Request("https://example.test/api/v1/search?q=AAPL")), null);
});

test("edge cache preserves ETags and refuses stale origin responses", async () => {
  const cache = new MemoryEdgeCache();
  const request = new Request("https://example.test/api/v1/companies/AAPL/analysis?view=overview");
  const fresh = new Response("fresh", {
    headers: { "Cache-Control": "public, s-maxage=300", ETag: 'W/"aapl-1"', [EDGE_CACHEABLE_HEADER]: "yes" },
  });
  assert.equal(isEdgeCacheableResponse(fresh), true);
  await cache.put(edgeCacheKey(request), prepareEdgeCachedResponse(fresh));
  assert.equal(await (await matchEdgeApiResponse(request, cache))?.text(), "fresh");

  const conditional = new Request(request.url, { headers: { "If-None-Match": 'W/"aapl-1"' } });
  assert.equal((await matchEdgeApiResponse(conditional, cache))?.status, 304);
  assert.equal(isEdgeCacheableResponse(new Response("stale", {
    headers: { "Cache-Control": "public, s-maxage=300", [EDGE_CACHEABLE_HEADER]: "no" },
  })), false);
  assert.equal(analysisEdgeCacheKeys(new Request(request.url, { method: "POST" })).length, 11);
  assert.equal(
    edgeCacheKey(new Request("https://example.test/api/v1/companies/aapl/analysis?view=overview")).url,
    edgeCacheKey(request).url,
  );
});

test("the Worker serves a repeated price-history request from edge cache", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = (globalThis as typeof globalThis & { caches?: unknown }).caches;
  const edgeCache = new MemoryEdgeCache();
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    return new Response(JSON.stringify({
      data: { tradesTable: { rows: [
        { date: "08/28/2026", close: "$105", open: "$104", high: "$106", low: "$103", volume: "1000" },
        { date: "08/27/2026", close: "$103", open: "$102", high: "$104", low: "$101", volume: "900" },
      ] } },
    }), { headers: { "content-type": "application/json" } });
  };
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: edgeCache } });

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("edge-cache-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const requestUrl = "http://localhost/api/v1/companies/EDGE/price-history?range=1y";
    const pending: Promise<unknown>[] = [];
    const context = { waitUntil(task: Promise<unknown>) { pending.push(task); }, passThroughOnException() {} };
    const environment = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

    const first = await worker.fetch(new Request(requestUrl), environment, context);
    assert.equal(first.headers.get("x-aplex-edge-cache"), "MISS");
    await Promise.all(pending.splice(0));
    const etag = first.headers.get("etag");
    await first.arrayBuffer();

    const second = await worker.fetch(new Request(requestUrl), environment, context);
    assert.equal(second.headers.get("x-aplex-edge-cache"), "HIT");
    await second.arrayBuffer();
    assert.equal(providerRequests, 1);

    const conditional = await worker.fetch(new Request(requestUrl, { headers: { "If-None-Match": etag ?? "" } }), environment, context);
    assert.equal(conditional.status, 304);
    assert.equal(conditional.headers.get("x-aplex-edge-cache"), "HIT");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) Reflect.deleteProperty(globalThis, "caches");
    else Object.defineProperty(globalThis, "caches", { configurable: true, value: originalCaches });
  }
});
