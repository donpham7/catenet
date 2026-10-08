// A timeout stops the whole process group: a hung test's worker must not outlive the grading (M4 review).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/exec.js";

describe("run", () => {
  it("kills the whole process group on timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cnexec-"));
    try {
      const marker = `catenet-hang-${process.pid}`;
      writeFileSync(
        join(dir, `${marker}.test.mjs`),
        'import { test } from "node:test";\ntest("hangs", () => { for (;;) {} });\n',
      );
      const r = await run(process.execPath, ["--test", `${marker}.test.mjs`], { cwd: dir, timeoutMs: 1500 });
      expect(r.timedOut).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const left = execFileSync("ps", ["-ww", "-o", "command=", "-ax"], { encoding: "utf8" })
        .split("\n")
        .filter((l) => l.includes(marker));
      expect(left).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns output and exit codes without throwing", async () => {
    const r = await run(process.execPath, ["-e", "console.log('hi'); process.exit(3)"], { cwd: tmpdir() });
    expect(r).toMatchObject({ code: 3, stdout: "hi\n", timedOut: false });
    expect((await run("definitely-not-a-command-xyz", [], { cwd: tmpdir() })).code).not.toBe(0);
  });
});
