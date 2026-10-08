import assert from "node:assert/strict";
import { test } from "node:test";
import { priceBadge } from "../../src/storefront/badge.ts";

test("price badges keep their USD output", () => {
  assert.equal(priceBadge(4), "[$4.00]");
});
