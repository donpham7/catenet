import assert from "node:assert/strict";
import { test } from "node:test";
import { describeNotificationsConfig } from "../src/notifications/config.ts";
import { summarizeNotificationsHelpers } from "../src/notifications/helpers.ts";

test("notifications helpers", () => {
  assert.equal(describeNotificationsConfig(2), "notifications:config:2");
  assert.ok(summarizeNotificationsHelpers([" A "]).endsWith("|a"));
});
