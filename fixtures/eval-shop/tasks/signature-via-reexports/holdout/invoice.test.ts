import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("invoice lines keep their USD output", () => {
  assert.equal(require("../../src/legacy/invoice.cjs").invoiceLine("Total", 3), "Total: $3.00");
});
