// Grading a finished run. Edit tasks: type-check the agent's result, then run the held-out acceptance test and one
// held-out test per dependent. A dependent is broken when its test fails or its file has type errors. Question tasks:
// precision and recall of ANSWER.json against the task's answer.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec.js";
import { checkout } from "./paths.js";
import type { Edge, EditTask, QuestionTask } from "./suite.js";
import { copyHoldout } from "./workspace.js";

export interface DependentResult {
  file: string;
  edge: Edge;
  broken: boolean;
  /** Why it counts as broken: its held-out test failed, and/or its file has type errors. */
  why: ("test" | "types")[];
}

export interface EditResult {
  kind: "edit";
  typecheckOk: boolean;
  typeErrorFiles: string[];
  visibleTestsOk: boolean;
  acceptancePassed: boolean;
  dependents: DependentResult[];
  /** Broken dependents of every kind, controls included. */
  dependentsBroken: number;
  /** Broken `none`-edge controls: dependents no static graph can see, reported apart from the primary metric. */
  controlsBroken: number;
  /**
   * Primary edit metric (ADR-0016): the task is done and no dependent that a code graph can see broke. Controls are
   * excluded (owner decision after the pilot: the template-import control broke in every session in both conditions).
   */
  passedWithoutBreakage: boolean;
}

export interface QuestionResult {
  kind: "question";
  answered: boolean;
  files: string[];
  precision: number;
  recall: number;
}

export type CheckResult = EditResult | QuestionResult;

const TYPE_ERROR = /^(.+?)\(\d+,\d+\): error TS\d+/;

/**
 * Type-checks with the checkout's compiler and Node types by absolute path, never the repo's node_modules links: the
 * agent can rewrite those (an `npm install` removes them; a replaced shim could fake a pass) (M4 review).
 */
async function typecheck(repo: string): Promise<{ ok: boolean; files: string[] }> {
  const modules = join(checkout(), "node_modules");
  const args = ["-p", ".", "--pretty", "false", "--typeRoots", join(modules, "@types")];
  const r = await run(join(modules, ".bin", "tsc"), args, {
    cwd: repo,
    timeoutMs: 180_000,
  });
  const files = new Set<string>();
  for (const line of `${r.stdout}\n${r.stderr}`.split("\n")) {
    const m = TYPE_ERROR.exec(line.trim());
    if (m?.[1]) files.add(m[1].split("\\").join("/"));
  }
  return { ok: r.code === 0, files: [...files].sort() };
}

const nodeTest = (repo: string, ...files: string[]) =>
  run(process.execPath, ["--test", ...files], { cwd: repo, timeoutMs: 120_000 });

export async function checkEdit(repo: string, task: EditTask): Promise<EditResult> {
  const types = await typecheck(repo);
  const visible = await nodeTest(repo, "test/**/*.test.ts");
  copyHoldout(task, repo);
  const holdout = (rel: string) => join("test", "holdout", rel.split("/").pop() as string);
  const acceptancePassed = (await nodeTest(repo, holdout(task.acceptance))).code === 0;
  const dependents: DependentResult[] = [];
  for (const d of task.dependents) {
    const why: DependentResult["why"] = [];
    if ((await nodeTest(repo, holdout(d.test))).code !== 0) why.push("test");
    if (types.files.includes(d.file)) why.push("types");
    dependents.push({ file: d.file, edge: d.edge, broken: why.length > 0, why });
  }
  const dependentsBroken = dependents.filter((d) => d.broken).length;
  const controlsBroken = dependents.filter((d) => d.broken && d.edge === "none").length;
  return {
    kind: "edit",
    typecheckOk: types.ok,
    typeErrorFiles: types.files,
    visibleTestsOk: visible.code === 0,
    acceptancePassed,
    dependents,
    dependentsBroken,
    controlsBroken,
    passedWithoutBreakage: acceptancePassed && dependentsBroken - controlsBroken === 0,
  };
}

const normalize = (p: string) => p.trim().replace(/\\/g, "/").replace(/^\.\//, "");

export function checkQuestion(repo: string, task: QuestionTask): QuestionResult {
  const path = join(repo, "ANSWER.json");
  let files: string[] = [];
  let answered = false;
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { files?: unknown };
      if (Array.isArray(raw.files)) {
        files = [
          ...new Set(raw.files.filter((f): f is string => typeof f === "string").map(normalize)),
        ].sort();
        answered = true;
      }
    } catch {
      // Unparseable: not answered.
    }
  }
  const truth = new Set(task.answer.map(normalize));
  const hits = files.filter((f) => truth.has(f)).length;
  return {
    kind: "question",
    answered,
    files,
    precision: files.length === 0 ? 0 : hits / files.length,
    recall: hits / truth.size,
  };
}
