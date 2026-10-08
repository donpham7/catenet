// The patch driver: applies a task's canned patch instead of running an agent. Free and deterministic, it checks the
// harness itself (does grading detect a correct change and a change that breaks dependents?). It is never an
// experimental condition and its reports never back claims.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../exec.js";
import { type Driver, emptyResult } from "./types.js";

export type PatchChoice = "correct" | "breaks-dependents" | "none";

export function createPatchDriver(choice: PatchChoice): Driver {
  return {
    name: "patch",
    version: async () => `patch:${choice}`,
    async run(ctx) {
      const started = performance.now();
      const { task, repo } = ctx;
      if (task.kind === "question") {
        const files =
          choice === "correct"
            ? task.answer
            : choice === "breaks-dependents"
              ? task.answer.slice(0, 1)
              : null;
        if (files) writeFileSync(join(repo, "ANSWER.json"), `${JSON.stringify({ files })}\n`);
        return emptyResult(performance.now() - started);
      }
      const patch = join(task.dir, "patches", `${choice}.patch`);
      if (choice !== "none" && existsSync(patch)) {
        const r = await run("git", ["apply", patch], { cwd: repo });
        if (r.code !== 0)
          return { ...emptyResult(0), status: "error", error: `git apply failed: ${r.stderr}` };
      }
      return emptyResult(performance.now() - started);
    },
  };
}
