import assert from "node:assert/strict";
import { test } from "node:test";
import { describeInventoryConfig } from "../src/inventory/config.ts";
import { summarizeInventoryHelpers } from "../src/inventory/helpers.ts";

test("inventory helpers", () => {
  assert.equal(describeInventoryConfig(2), "inventory:config:2");
  assert.ok(summarizeInventoryHelpers([" A "]).endsWith("|a"));
});
