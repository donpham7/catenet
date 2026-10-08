import assert from "node:assert/strict";
import { test } from "node:test";
import { describeReviewsConfig } from "../src/reviews/config.ts";
import { summarizeReviewsHelpers } from "../src/reviews/helpers.ts";

test("reviews helpers", () => {
  assert.equal(describeReviewsConfig(2), "reviews:config:2");
  assert.ok(summarizeReviewsHelpers([" A "]).endsWith("|a"));
});
