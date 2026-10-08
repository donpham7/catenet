import assert from "node:assert/strict";
import { test } from "node:test";
import { addItem, clearCarts, getCart } from "../src/cart/store.ts";

test("adds items to a cart", () => {
  clearCarts();
  addItem("c1", { sku: "A", price: 2, quantity: 1 });
  assert.equal(getCart("c1").items.length, 1);
});
