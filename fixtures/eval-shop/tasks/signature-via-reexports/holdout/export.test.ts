import assert from "node:assert/strict";
import { test } from "node:test";
import { exportColumn, PRICE_COLUMN } from "../../src/reports/export.ts";

test("the price export column keeps its USD output", async () => {
  assert.deepEqual(await exportColumn(PRICE_COLUMN.module, PRICE_COLUMN.fn, [1, 2.5]), ["$1.00", "$2.50"]);
});
