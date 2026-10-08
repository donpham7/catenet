import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAuditConfig } from "../src/audit/config.ts";
import { summarizeAuditHelpers } from "../src/audit/helpers.ts";

test("audit helpers", () => {
  assert.equal(describeAuditConfig(2), "audit:config:2");
  assert.ok(summarizeAuditHelpers([" A "]).endsWith("|a"));
});
