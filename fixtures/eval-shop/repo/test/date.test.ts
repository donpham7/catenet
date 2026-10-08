import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, parseDate } from "../src/utils/date.ts";

test("round-trips a date", () => {
  assert.equal(formatDate(parseDate("2026-03-01")), "2026-03-01");
});
