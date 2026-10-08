import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

test("the module lives at src/time/date.ts and the old file is gone", async () => {
  const date = (await import("../../src/time/date.ts")) as Record<string, unknown>;
  for (const fn of ["formatDate", "parseDate", "addDays"]) assert.equal(typeof date[fn], "function");
  assert.equal(existsSync(join(import.meta.dirname, "../../src/utils/date.ts")), false);
});
