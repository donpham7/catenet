import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTax, formatPrice } from "../src/money/index.ts";

test("formats prices", () => {
  assert.equal(formatPrice(12.5), "$12.50");
});

test("applies tax", () => {
  assert.equal(applyTax(100, 0.1), 110);
});
