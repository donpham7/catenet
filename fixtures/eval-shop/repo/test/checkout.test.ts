import assert from "node:assert/strict";
import { test } from "node:test";
import { addItem, clearCarts } from "../src/cart/store.ts";
import { checkoutTotal } from "../src/checkout/total.ts";

test("totals a cart with tax", () => {
  clearCarts();
  addItem("c1", { sku: "A", price: 10, quantity: 2 });
  assert.equal(checkoutTotal("c1", 0.1), "$22.00");
});
