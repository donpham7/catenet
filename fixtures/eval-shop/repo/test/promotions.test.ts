import assert from "node:assert/strict";
import { test } from "node:test";
import { describePromotionsConfig } from "../src/promotions/config.ts";
import { summarizePromotionsHelpers } from "../src/promotions/helpers.ts";

test("promotions helpers", () => {
  assert.equal(describePromotionsConfig(2), "promotions:config:2");
  assert.ok(summarizePromotionsHelpers([" A "]).endsWith("|a"));
});
