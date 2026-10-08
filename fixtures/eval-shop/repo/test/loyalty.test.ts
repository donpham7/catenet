import assert from "node:assert/strict";
import { test } from "node:test";
import { describeLoyaltyConfig } from "../src/loyalty/config.ts";
import { summarizeLoyaltyHelpers } from "../src/loyalty/helpers.ts";

test("loyalty helpers", () => {
  assert.equal(describeLoyaltyConfig(2), "loyalty:config:2");
  assert.ok(summarizeLoyaltyHelpers([" A "]).endsWith("|a"));
});
