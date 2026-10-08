import assert from "node:assert/strict";
import { test } from "node:test";
import { addItem, clearCarts } from "../../src/cart/store.ts";
import { checkoutTotal } from "../../src/checkout/total.ts";

test("checkout total keeps its USD output", () => {
  clearCarts();
  addItem("h1", { sku: "A", price: 10, quantity: 2 });
  assert.equal(checkoutTotal("h1", 0.1), "$22.00");
});
