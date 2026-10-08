import assert from "node:assert/strict";
import { test } from "node:test";
import { inviteErrors } from "../../src/accounts/invite.ts";

test("invites still reject only invalid addresses", () => {
  assert.deepEqual(inviteErrors(["ann@example.com", "nope"]), ["nope"]);
});
