import assert from "node:assert/strict";
import test from "node:test";
import { formatFreshnessTime } from "../lib/format.ts";

test("date-only quote freshness never invents a time or changes with timezone", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ["UTC", "America/Vancouver"]) {
      process.env.TZ = timezone;
      assert.equal(formatFreshnessTime("Sep 24, 2026"), "Sep 24, 2026");
      assert.equal(formatFreshnessTime("2026-09-24"), "Sep 24, 2026");
      assert.equal(formatFreshnessTime("2026-09-24T07:00:00Z"), "Sep 24, 7:00 AM UTC");
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
