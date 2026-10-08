import assert from "node:assert/strict";
import { test } from "node:test";
import { describeMediaConfig } from "../src/media/config.ts";
import { summarizeMediaHelpers } from "../src/media/helpers.ts";

test("media helpers", () => {
  assert.equal(describeMediaConfig(2), "media:config:2");
  assert.ok(summarizeMediaHelpers([" A "]).endsWith("|a"));
});
