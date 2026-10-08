import assert from "node:assert/strict";
import { test } from "node:test";
import { describePlansConfig } from "../src/plans/config.ts";
import { summarizePlansHelpers } from "../src/plans/helpers.ts";

test("plans helpers", () => {
  assert.equal(describePlansConfig(2), "plans:config:2");
  assert.ok(summarizePlansHelpers([" A "]).endsWith("|a"));
});
