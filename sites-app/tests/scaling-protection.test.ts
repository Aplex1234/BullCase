import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryFixedWindowCounter,
  coordinateColdBuild,
  reservePacedSlot,
  type InFlightMap,
} from "../lib/server/scaling-core.ts";
import { stampTrustedClientIdentity } from "../lib/server/scaling-protection.ts";

function createSharedBuildStore() {
  let leased = false;
  let result: { ticker: string; generation: number } | null = null;
  return {
    readResult: async () => result,
    writeResult: async (value: { ticker: string; generation: number }) => { result = value; },
    acquireLease: async () => {
      if (leased) return false;
      leased = true;
      return true;
    },
    releaseLease: async () => { leased = false; },
  };
}

test("30 simultaneous cold requests across isolates share one upstream build", async () => {
  const store = createSharedBuildStore();
  const isolateMaps: InFlightMap[] = Array.from({ length: 30 }, () => new Map());
  let builds = 0;
  const requests = Array.from({ length: 30 }, (_, index) => coordinateColdBuild({
    key: "analysis-build:v1:AAPL:overview",
    inFlight: isolateMaps[index % isolateMaps.length],
    ...store,
    pollIntervalMs: 20,
    leaseRetryIntervalMs: 20,
    timeoutMs: 1_000,
    build: async () => {
      builds += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { ticker: "AAPL", generation: builds };
    },
  }));

  const results = await Promise.all(requests);
  assert.equal(builds, 1);
  assert.equal(new Set(results.map((result) => result.generation)).size, 1);
  assert.ok(results.every((result) => result.ticker === "AAPL"));
});

test("a waiting isolate retries after a failed leader releases the lease", async () => {
  const store = createSharedBuildStore();
  let attempts = 0;
  const request = (inFlight: InFlightMap) => coordinateColdBuild({
    key: "analysis-build:v1:AAPL:full",
    inFlight,
    ...store,
    pollIntervalMs: 20,
    leaseRetryIntervalMs: 20,
    timeoutMs: 1_000,
    build: async () => {
      attempts += 1;
      if (attempts === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error("provider failed");
      }
      return { ticker: "AAPL", generation: attempts };
    },
  });

  const leader = request(new Map());
  const follower = request(new Map());
  await assert.rejects(leader, /provider failed/);
  assert.deepEqual(await follower, { ticker: "AAPL", generation: 2 });
  assert.equal(attempts, 2);
});

test("fixed-window counters enforce the configured limit and reset at the next window", () => {
  const counter = new MemoryFixedWindowCounter();
  const general = Array.from({ length: 51 }, () => counter.consume("general:visitor", 50, 60_000, 1_000));
  assert.ok(general.slice(0, 50).every((result) => result.allowed));
  assert.equal(general[50].allowed, false);
  assert.equal(counter.consume("general:visitor", 50, 60_000, 60_000).allowed, true);

  const sec = Array.from({ length: 9 }, () => counter.consume("sec:global", 8, 1_000, 100));
  assert.ok(sec.slice(0, 8).every((result) => result.allowed));
  assert.equal(sec[8].allowed, false);
  assert.equal(counter.consume("sec:global", 8, 1_000, 1_000).allowed, true);
});

test("SEC pacing reserves no more than eight starts per second", () => {
  let nextAvailableAt = 0;
  const permits = Array.from({ length: 9 }, () => {
    const reservation = reservePacedSlot(nextAvailableAt, 0, 125);
    nextAvailableAt = reservation.nextAvailableAt;
    return reservation.permitAt;
  });
  assert.deepEqual(permits, [0, 125, 250, 375, 500, 625, 750, 875, 1_000]);
});

test("the Worker overwrites an untrusted client identity header", async () => {
  const request = new Request("https://example.test/api/v1/search", {
    headers: { "x-bullcase-edge-client-key": "spoofed", "cf-connecting-ip": "203.0.113.10" },
  });
  const stamped = await stampTrustedClientIdentity(request);
  assert.equal(stamped.headers.get("x-bullcase-edge-client-key"), "local-development");
});

test("signed-in users on the same network receive separate rate-limit identities", async () => {
  const requestFor = (userId: string) => {
    const request = new Request("https://example.test/api/v1/search", {
      headers: {
        "oai-authenticated-user-id": userId,
        "oai-authenticated-user-email": "test@example.invalid",
        "cf-connecting-ip": "203.0.113.10",
      },
    });
    Object.defineProperty(request, "cf", { value: {} });
    return request;
  };
  const first = (await stampTrustedClientIdentity(requestFor("first-user"))).headers.get("x-bullcase-edge-client-key");
  const second = (await stampTrustedClientIdentity(requestFor("second-user"))).headers.get("x-bullcase-edge-client-key");
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.notEqual(first, "first-user");
});
