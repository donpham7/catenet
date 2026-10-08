import assert from "node:assert/strict";
import { test } from "node:test";
import { describeRatesConfig } from "../src/rates/config.ts";
import { summarizeRatesHelpers } from "../src/rates/helpers.ts";

test("rates helpers", () => {
  assert.equal(describeRatesConfig(2), "rates:config:2");
  assert.ok(summarizeRatesHelpers([" A "]).endsWith("|a"));
});
