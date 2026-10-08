import assert from "node:assert/strict";
import { test } from "node:test";
import { subscribable } from "../../src/newsletter/subscribe.ts";

test("only valid addresses are subscribable", () => {
  assert.deepEqual(subscribable(["ann@example.com", "nope", ""]), ["ann@example.com"]);
});
