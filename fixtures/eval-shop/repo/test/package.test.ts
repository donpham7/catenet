import assert from "node:assert/strict";
import { test } from "node:test";
import * as shop from "../src/index.ts";

test("exposes the public API", () => {
  for (const name of ["formatPrice", "getCart", "addItem", "checkoutTotal", "formatDate", "isValidEmail"]) {
    assert.equal(typeof (shop as Record<string, unknown>)[name], "function", name);
  }
});
