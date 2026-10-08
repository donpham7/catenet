import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("schedule normalisation still works", () => {
  assert.equal(require("../../src/legacy/schedule.cjs").normalize("2026-03-01"), "2026-03-01");
});
