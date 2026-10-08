// The harness grades correctly: on every task, the correct patch passes with nothing broken, the patch that misses
// dependents breaks exactly the ones it misses (while still type-checking), and an untouched repo fails acceptance.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkEdit,
  checkQuestion,
  createPatchDriver,
  defaultSuiteDir,
  loadSuite,
  type PatchChoice,
  prepareWorkspace,
  type Task,
} from "../src/index.js";

const suite = loadSuite(defaultSuiteDir());
const task = (id: string) => suite.tasks.find((t) => t.id === id) as Task;

async function grade(id: string, choice: PatchChoice) {
  const ws = prepareWorkspace(suite);
  try {
    const t = task(id);
    const r = await createPatchDriver(choice).run({
      task: t,
      condition: "baseline",
      repo: ws.repo,
      pluginDir: "",
      env: process.env,
      transcriptPath: "",
      forbidden: [],
    });
    expect(r.status).toBe("ok");
    return t.kind === "edit" ? await checkEdit(ws.repo, t) : checkQuestion(ws.repo, t);
  } finally {
    ws.cleanup();
  }
}

/** The dependents each breaks-dependents patch misses (what a careless change would break). */
const MISSED: Record<string, string[]> = {
  "signature-via-reexports": ["src/legacy/invoice.cjs", "src/reports/export.ts"],
  "boolean-to-result": [
    "src/accounts/invite.ts",
    "src/legacy/mailer.cjs",
    "src/newsletter/subscribe.ts",
    "src/signup/form.ts",
  ],
  "rename-published-api": ["src/admin/dashboard.ts", "src/legacy/cart-sync.cjs"],
  "move-module": ["src/jobs/cleanup.cjs", "src/legacy/schedule.cjs"],
};

describe("grading edit tasks", () => {
  it("has the pre-registered task list", () => {
    expect(suite.tasks.map((t) => t.id)).toEqual([
      "boolean-to-result",
      "leaf-control",
      "move-module",
      "q-dependents",
      "q-tests-for",
      "rename-published-api",
      "signature-via-reexports",
    ]);
  });

  for (const [id, missed] of Object.entries(MISSED)) {
    it(`${id}: correct passes, careless breaks exactly the missed dependents, untouched fails`, async () => {
      const correct = await grade(id, "correct");
      expect(correct).toMatchObject({
        kind: "edit",
        typecheckOk: true,
        visibleTestsOk: true,
        acceptancePassed: true,
      });
      expect(correct.kind === "edit" && correct.dependentsBroken).toBe(0);
      expect(correct.kind === "edit" && correct.passedWithoutBreakage).toBe(true);

      const careless = await grade(id, "breaks-dependents");
      if (careless.kind !== "edit") throw new Error("expected an edit result");
      expect(careless.typecheckOk).toBe(true); // the type checker can't see these breaks
      expect(careless.acceptancePassed).toBe(true);
      expect(
        careless.dependents
          .filter((d) => d.broken)
          .map((d) => d.file)
          .sort(),
      ).toEqual(missed);
      // Every careless patch breaks at least one dependent the graph can see, so it never passes.
      expect(careless.passedWithoutBreakage).toBe(false);

      const untouched = await grade(id, "none");
      expect(untouched.kind === "edit" && untouched.acceptancePassed).toBe(false);
    }, 120_000);
  }

  it("a broken control (a dependent no graph can see) is reported but doesn't fail the primary metric", async () => {
    const ws = prepareWorkspace(suite);
    try {
      const t = task("signature-via-reexports");
      if (t.kind !== "edit") throw new Error("expected an edit task");
      await createPatchDriver("correct").run({
        task: t,
        condition: "baseline",
        repo: ws.repo,
        pluginDir: "",
        env: process.env,
        transcriptPath: "",
        forbidden: [],
      });
      // Undo only the export.ts part of the correct patch: the template-import control breaks again.
      const { execFileSync } = await import("node:child_process");
      execFileSync("git", ["-C", ws.repo, "checkout", "--", "src/reports/export.ts"]);
      const r = await checkEdit(ws.repo, t);
      expect(r).toMatchObject({ dependentsBroken: 1, controlsBroken: 1, passedWithoutBreakage: true });
    } finally {
      ws.cleanup();
    }
  }, 60_000);

  it("type-checks with the checkout's compiler, not links the agent could change", async () => {
    const ws = prepareWorkspace(suite);
    try {
      const t = task("leaf-control");
      if (t.kind !== "edit") throw new Error("expected an edit task");
      rmSync(join(ws.repo, "node_modules"), { recursive: true, force: true }); // e.g. after `npm install`
      expect(await checkEdit(ws.repo, t)).toMatchObject({ typecheckOk: true });
    } finally {
      ws.cleanup();
    }
  }, 60_000);

  it("leaf-control: no dependents; only acceptance decides", async () => {
    const correct = await grade("leaf-control", "correct");
    expect(correct).toMatchObject({ acceptancePassed: true, dependents: [], passedWithoutBreakage: true });
    expect(await grade("leaf-control", "none")).toMatchObject({ acceptancePassed: false });
  }, 60_000);
});

describe("grading question tasks", () => {
  it("scores precision and recall of ANSWER.json", async () => {
    expect(await grade("q-dependents", "correct")).toMatchObject({ answered: true, precision: 1, recall: 1 });
    expect(await grade("q-dependents", "breaks-dependents")).toMatchObject({
      answered: true,
      precision: 1,
      recall: 1 / 6,
    });
    expect(await grade("q-tests-for", "none")).toMatchObject({ answered: false, precision: 0, recall: 0 });
  });
});
