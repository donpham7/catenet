// The eval suite (fixtures/eval-shop): a runnable repository plus pre-registered tasks. Task files and held-out tests
// live outside repo/, so the agent never sees them. The suite hash covers every file, so any change after
// pre-registration is detectable.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** How the graph reaches a dependent: `none` marks a control that Catenet can't see (e.g. a template import()). */
export type Edge = "exact" | "heuristic" | "none";

export interface TaskDependent {
  file: string;
  edge: Edge;
  /** Held-out test for this dependent, relative to the task directory. */
  test: string;
}

interface TaskBase {
  id: string;
  category: string;
  /** The prompt text given to the agent. */
  prompt: string;
  /** The task's directory (fixtures/eval-shop/tasks/<id>). */
  dir: string;
}

export interface EditTask extends TaskBase {
  kind: "edit";
  /** Held-out acceptance test, relative to the task directory. */
  acceptance: string;
  /** What a correct change must keep working. Empty for a control task (no dependents). */
  dependents: TaskDependent[];
}

export interface QuestionTask extends TaskBase {
  kind: "question";
  /** The true answer: repository-relative paths. */
  answer: string[];
}

export type Task = EditTask | QuestionTask;

export interface Suite {
  name: string;
  dir: string;
  repo: string;
  tasks: Task[];
  hash: string;
}

const EDGES = new Set<Edge>(["exact", "heuristic", "none"]);

function files(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n !== ".catenet" && n !== "node_modules")
    .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
}

/** sha256 over every file's relative path and content, in sorted order. */
export function suiteHash(dir: string): string {
  const h = createHash("sha256");
  for (const f of files(dir).sort()) {
    h.update(relative(dir, f).split("\\").join("/"));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

function fail(id: string, message: string): never {
  throw new Error(`task ${id}: ${message}`);
}

function loadTask(dir: string, id: string): Task {
  const spec = JSON.parse(readFileSync(join(dir, "task.json"), "utf8")) as Record<string, unknown>;
  if (spec.id !== id) fail(id, `task.json id is ${String(spec.id)}`);
  const prompt = readFileSync(join(dir, String(spec.prompt ?? "prompt.md")), "utf8");
  const base = { id, category: String(spec.category ?? ""), prompt, dir };
  if (spec.kind === "edit") {
    const acceptance = String(spec.acceptance ?? "");
    if (!existsSync(join(dir, acceptance))) fail(id, `missing acceptance test ${acceptance}`);
    const dependents = (spec.dependents ?? []) as TaskDependent[];
    for (const d of dependents) {
      if (!EDGES.has(d.edge)) fail(id, `unknown edge ${String(d.edge)} for ${d.file}`);
      if (!existsSync(join(dir, d.test))) fail(id, `missing held-out test ${d.test}`);
    }
    return { ...base, kind: "edit", acceptance, dependents };
  }
  if (spec.kind === "question") {
    const answer = (spec.answer as { files?: unknown } | undefined)?.files;
    if (!Array.isArray(answer) || answer.length === 0) fail(id, "question tasks need answer.files");
    return { ...base, kind: "question", answer: answer.map(String) };
  }
  return fail(id, `unknown kind ${String(spec.kind)}`);
}

export function loadSuite(dir: string): Suite {
  const tasksDir = join(dir, "tasks");
  const tasks = readdirSync(tasksDir)
    .filter((n) => statSync(join(tasksDir, n)).isDirectory())
    .sort()
    .map((id) => loadTask(join(tasksDir, id), id));
  return { name: relative(join(dir, ".."), dir), dir, repo: join(dir, "repo"), tasks, hash: suiteHash(dir) };
}
