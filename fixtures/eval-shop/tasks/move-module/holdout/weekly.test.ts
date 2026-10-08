import assert from "node:assert/strict";
import { test } from "node:test";
import { weekRange } from "../../src/reports/weekly.ts";

test("weekly range still works", () => {
  assert.equal(weekRange(new Date("2026-03-01T00:00:00Z")), "2026-03-01..2026-03-07");
});
