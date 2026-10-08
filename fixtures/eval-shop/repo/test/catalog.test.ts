import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCatalogConfig } from "../src/catalog/config.ts";
import { summarizeCatalogHelpers } from "../src/catalog/helpers.ts";

test("catalog helpers", () => {
  assert.equal(describeCatalogConfig(2), "catalog:config:2");
  assert.ok(summarizeCatalogHelpers([" A "]).endsWith("|a"));
});
