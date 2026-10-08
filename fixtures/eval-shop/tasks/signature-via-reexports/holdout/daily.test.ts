import assert from "node:assert/strict";
import { test } from "node:test";
import { dailySummary } from "../../src/reports/daily.ts";

test("daily summary keeps its USD output", async () => {
  assert.equal(await dailySummary([1, 2]), "2 orders, $3.00");
});
