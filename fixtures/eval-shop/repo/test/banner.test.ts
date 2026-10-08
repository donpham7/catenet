import assert from "node:assert/strict";
import { test } from "node:test";
import { bannerText } from "../src/admin/banner.ts";

test("greets by name", () => {
  assert.equal(bannerText("Ann"), "Welcome back, Ann!");
});
