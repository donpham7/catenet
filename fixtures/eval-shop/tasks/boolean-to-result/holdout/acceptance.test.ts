import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidEmail } from "../../src/validation/email.ts";

test("explains why an address is invalid", () => {
  assert.deepEqual(isValidEmail("ann@example.com"), { ok: true });
  assert.deepEqual(isValidEmail("   "), { ok: false, reason: "empty" });
  assert.deepEqual(isValidEmail("ann.example.com"), { ok: false, reason: "missing @" });
  assert.deepEqual(isValidEmail("ann@"), { ok: false, reason: "malformed" });
});
