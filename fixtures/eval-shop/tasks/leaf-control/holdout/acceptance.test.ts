import assert from "node:assert/strict";
import { test } from "node:test";
import { bannerText } from "../../src/admin/banner.ts";

test("trims the name and falls back to guest", () => {
  assert.equal(bannerText("  Ann "), "Welcome back, Ann!");
  assert.equal(bannerText("   "), "Welcome back, guest!");
  assert.equal(bannerText(""), "Welcome back, guest!");
});
