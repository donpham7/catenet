import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSearchConfig } from "../src/search/config.ts";
import { summarizeSearchHelpers } from "../src/search/helpers.ts";

test("search helpers", () => {
  assert.equal(describeSearchConfig(2), "search:config:2");
  assert.ok(summarizeSearchHelpers([" A "]).endsWith("|a"));
});
