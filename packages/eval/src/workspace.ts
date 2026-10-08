// A fresh copy of the eval repository for one run: git-initialised (so the agent can diff), with the checkout's
// TypeScript compiler and Node types linked in so `npm run typecheck` works offline. Held-out tests are copied in only
// after the agent has finished.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { checkout } from "./paths.js";
import type { EditTask, Suite } from "./suite.js";

export interface Workspace {
  /** Temporary directory holding the repo, the daemon runtime dir and the transcript. */
  root: string;
  repo: string;
  /** CATENET_RUNTIME_DIR for this run's daemon. */
  runtime: string;
  cleanup(): void;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "eval",
  GIT_AUTHOR_EMAIL: "eval@example.invalid",
  GIT_COMMITTER_NAME: "eval",
  GIT_COMMITTER_EMAIL: "eval@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

export function prepareWorkspace(suite: Suite, parent = tmpdir()): Workspace {
  const root = mkdtempSync(join(parent, "catenet-eval-"));
  const repo = join(root, "repo");
  cpSync(suite.repo, repo, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).some((p) => p === ".catenet" || p === "node_modules"),
  });
  const modules = join(repo, "node_modules");
  mkdirSync(join(modules, ".bin"), { recursive: true });
  mkdirSync(join(modules, "@types"), { recursive: true });
  symlinkSync(join(checkout(), "node_modules", ".bin", "tsc"), join(modules, ".bin", "tsc"));
  symlinkSync(join(checkout(), "node_modules", "@types", "node"), join(modules, "@types", "node"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { env: GIT_ENV, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(repo, ".git", "info", "exclude"), "node_modules/\n");
  git("add", "-A");
  git("commit", "-qm", "initial");
  const runtime = join(root, "run");
  mkdirSync(runtime, { mode: 0o700 });
  return {
    root,
    repo,
    runtime,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

/** Copies a task's held-out tests into test/holdout/, overwriting anything the agent left there. */
export function copyHoldout(task: EditTask, repo: string): string {
  const target = join(repo, "test", "holdout");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(join(task.dir, "holdout"))) {
    cpSync(join(task.dir, "holdout", name), join(target, basename(name)));
  }
  return target;
}
