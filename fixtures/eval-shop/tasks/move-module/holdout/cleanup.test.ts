import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("cleanup still detects expired entries", () => {
  const { isExpired } = require("../../src/jobs/cleanup.cjs");
  assert.equal(isExpired("2026-01-01", 10, new Date("2026-02-01T00:00:00Z")), true);
  assert.equal(isExpired("2026-01-30", 10, new Date("2026-02-01T00:00:00Z")), false);
});
