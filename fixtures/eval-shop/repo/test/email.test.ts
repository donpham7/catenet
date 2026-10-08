import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidEmail } from "../src/validation/email.ts";

test("accepts a plain address", () => {
  assert.equal(isValidEmail("ann@example.com"), true);
});

test("rejects an address without @", () => {
  assert.equal(isValidEmail("ann.example.com"), false);
});
