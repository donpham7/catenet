import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("cart sync still counts items", () => {
  const store = require("../../src/cart/store.ts");
  store.clearCarts();
  store.addItem("h1", { sku: "A", price: 1, quantity: 3 });
  assert.equal(require("../../src/legacy/cart-sync.cjs").itemCount("h1"), 3);
});
