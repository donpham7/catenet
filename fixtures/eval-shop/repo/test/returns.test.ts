import assert from "node:assert/strict";
import { test } from "node:test";
import { describeReturnsConfig } from "../src/returns/config.ts";
import { summarizeReturnsHelpers } from "../src/returns/helpers.ts";

test("returns helpers", () => {
  assert.equal(describeReturnsConfig(2), "returns:config:2");
  assert.ok(summarizeReturnsHelpers([" A "]).endsWith("|a"));
});
