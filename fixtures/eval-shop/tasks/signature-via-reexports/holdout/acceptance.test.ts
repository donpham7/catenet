import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrice } from "../../src/money/format.ts";

test("formats USD and EUR, and requires a currency", () => {
  assert.equal(formatPrice(5, { currency: "USD" }), "$5.00");
  assert.equal(formatPrice(12.5, { currency: "EUR" }), "€12.50");
  assert.throws(() => (formatPrice as unknown as (n: number) => string)(5));
  assert.throws(() => formatPrice(5, { currency: "GBP" }));
});
