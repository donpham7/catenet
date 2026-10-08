import assert from "node:assert/strict";
import { test } from "node:test";
import { signupErrors } from "../../src/signup/form.ts";

test("signup still rejects a bad email and accepts a good one", () => {
  assert.deepEqual(signupErrors({ email: "nope", name: "Ann" }), ["email is invalid"]);
  assert.deepEqual(signupErrors({ email: "ann@example.com", name: "Ann" }), []);
});
