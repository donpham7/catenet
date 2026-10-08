import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptLines } from "../../src/checkout/receipt.ts";

test("receipt lines keep their USD output", () => {
  assert.deepEqual(receiptLines([{ sku: "A", price: 2, quantity: 3 }]), ["3 x A @ $2.00"]);
});
