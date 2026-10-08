import assert from "node:assert/strict";
import { test } from "node:test";
import { historyLines } from "../../src/orders/history.ts";

test("order history still formats dates", () => {
  assert.deepEqual(historyLines([{ id: "o1", placedAt: new Date("2026-03-01T00:00:00Z"), total: 1 }]), ["2026-03-01 o1"]);
});
