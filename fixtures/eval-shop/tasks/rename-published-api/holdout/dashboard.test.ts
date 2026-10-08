import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addItem, clearCarts } from "../../src/cart/store.ts";
import { cartSizes } from "../../src/admin/dashboard.ts";

test("the dashboard still counts items, using the new name", () => {
  clearCarts();
  addItem("h1", { sku: "A", price: 1, quantity: 1 });
  assert.deepEqual(cartSizes(["h1"]), { h1: 1 });
  const source = readFileSync(join(import.meta.dirname, "../../src/admin/dashboard.ts"), "utf8");
  assert.equal(/\bgetCart\b/.test(source), false);
});
