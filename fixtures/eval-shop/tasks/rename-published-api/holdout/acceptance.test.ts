import assert from "node:assert/strict";
import { test } from "node:test";
import * as entry from "../../src/index.ts";
import * as store from "../../src/cart/store.ts";

test("loadCart replaces getCart; the entry keeps a deprecated alias", () => {
  const s = store as Record<string, unknown>;
  assert.equal(typeof s.loadCart, "function");
  assert.equal("getCart" in s, false);
  const e = entry as Record<string, unknown>;
  assert.equal(e.loadCart, s.loadCart);
  assert.equal(e.getCart, s.loadCart);
});
