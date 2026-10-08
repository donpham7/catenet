import assert from "node:assert/strict";
import { test } from "node:test";
import { describeUsersConfig } from "../src/users/config.ts";
import { summarizeUsersHelpers } from "../src/users/helpers.ts";

test("users helpers", () => {
  assert.equal(describeUsersConfig(2), "users:config:2");
  assert.ok(summarizeUsersHelpers([" A "]).endsWith("|a"));
});
