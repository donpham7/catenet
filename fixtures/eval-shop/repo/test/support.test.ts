import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSupportConfig } from "../src/support/config.ts";
import { summarizeSupportHelpers } from "../src/support/helpers.ts";

test("support helpers", () => {
  assert.equal(describeSupportConfig(2), "support:config:2");
  assert.ok(summarizeSupportHelpers([" A "]).endsWith("|a"));
});
