import assert from "node:assert/strict";
import { test } from "node:test";
import { etaLabel } from "../../src/shipping/eta.ts";

test("shipping ETA still works", async () => {
  assert.equal(await etaLabel(new Date("2026-03-01T00:00:00Z"), 2), "arrives 2026-03-03");
});
