import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAnalyticsConfig } from "../src/analytics/config.ts";
import { summarizeAnalyticsHelpers } from "../src/analytics/helpers.ts";

test("analytics helpers", () => {
  assert.equal(describeAnalyticsConfig(2), "analytics:config:2");
  assert.ok(summarizeAnalyticsHelpers([" A "]).endsWith("|a"));
});
