import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("the mailer still sends only to valid addresses", () => {
  const { canSend } = require("../../src/legacy/mailer.cjs");
  assert.equal(canSend("ann@example.com"), true);
  assert.equal(canSend("nope"), false);
});
