import assert from "node:assert/strict";
import { test } from "node:test";
import * as shop from "../../src/index.ts";

test("the package still exports the date helpers", () => {
  const e = shop as Record<string, unknown>;
  assert.equal(typeof e.formatDate, "function");
  assert.equal(typeof e.parseDate, "function");
});
