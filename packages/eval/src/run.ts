// `catenet eval run`: runs the schedule, one fresh workspace per run, and writes raw.jsonl, meta.json and the report.
// Concurrency is 1 on purpose: durations and hook latency are only comparable without load from other runs.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { EventStore } from "@catenet/core";
import { checkEdit, checkQuestion } from "./checks.js";
import type { Driver, DriverResult } from "./drivers/types.js";
import { nodeEnv, run } from "./exec.js";
import { checkout, defaultPluginDir, defaultSuiteDir, lockFile, resultsDir } from "./paths.js";
import {
  buildReport,
  type CatenetStats,
  type Report,
  type RunMeta,
  type RunRow,
  readRows,
  writeReport,
} from "./report.js";
import { type Block, type Condition, makeSchedule } from "./schedule.js";
import { loadSuite, type Suite, type Task } from "./suite.js";
import { prepareWorkspace, type Workspace } from "./workspace.js";

export interface Lock {
  suite: string;
  hash: string;
  trials: number;
  model: string;
  maxTurns: number;
  seed: number;
  registeredAt: string;
}

export interface RunOptions {
  driver: Driver;
  trials: number;
  seed: number;
  /** Task ids to run; all tasks when omitted. */
  tasks?: string[];
  model: string | null;
  maxTurns: number | null;
  /** Stop between blocks once the agent cost reaches this. */
  maxCostUsd: number;
  outDir?: string;
  pluginDir?: string;
  suiteDir?: string;
  /** Infrastructure retries per run. */
  retries?: number;
  keepTranscripts?: boolean;
  /**
   * Continue the run in `outDir`: rebuild the same schedule (same seed, trials and tasks), skip runs already in
   * raw.jsonl, and append the rest.
   */
  resume?: boolean;
  /** Whether the agent's API is reachable. Default: a DNS lookup for the claude-code driver; always true otherwise. */
  online?: () => Promise<boolean>;
  /** How often to re-check while offline, and how long to wait in total before giving up. */
  offlinePollMs?: number;
  maxOfflineMs?: number;
  log?: (line: string) => void;
}

/** The agent's API answers over HTTPS (any HTTP status counts): a DNS answer alone can't tell an outage apart. */
async function apiReachable(): Promise<boolean> {
  try {
    await fetch("https://api.anthropic.com/", { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

const isOnline = (opts: RunOptions) =>
  opts.online ? opts.online() : opts.driver.name === "claude-code" ? apiReachable() : Promise.resolve(true);

/** The workspace in use, so an interrupt (Ctrl-C) can stop its daemon and delete it. */
let active: { ws: Workspace; pluginDir: string; catenet: boolean } | null = null;

function stopDaemonSync(ws: Workspace, pluginDir: string): void {
  try {
    execFileSync(process.execPath, [catenetCli(pluginDir), "daemon", "stop", "--repo", ws.repo], {
      env: nodeEnv({ CATENET_RUNTIME_DIR: ws.runtime }),
      stdio: "ignore",
      timeout: 15_000,
    });
  } catch {
    // Best effort.
  }
}

/**
 * Waits while the agent's API is unreachable, so a network outage pauses the run instead of turning every remaining
 * session into an infrastructure error (found when the owner went offline mid-run).
 */
async function waitOnline(opts: RunOptions): Promise<void> {
  if (await isOnline(opts)) return;
  const poll = opts.offlinePollMs ?? 30_000;
  const deadline = Date.now() + (opts.maxOfflineMs ?? 4 * 3_600_000);
  opts.log?.("  offline: waiting for the network before the next session");
  while (Date.now() < deadline) {
    await sleep(poll);
    if (await isOnline(opts)) {
      opts.log?.("  back online");
      return;
    }
  }
  throw new Error("the network has been down too long; resume later with --resume");
}

export function readLock(path = lockFile()): Lock | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Lock;
  } catch {
    return null;
  }
}

/** Records the pre-registration: the suite hash and the run parameters, committed before the full run. */
export function writeLock(
  lock: Omit<Lock, "hash" | "suite" | "registeredAt">,
  suiteDir = defaultSuiteDir(),
  path = lockFile(),
): Lock {
  const suite = loadSuite(suiteDir);
  const full: Lock = { suite: suite.name, hash: suite.hash, ...lock, registeredAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(full, null, 2)}\n`);
  return full;
}

function selectTasks(suite: Suite, ids?: string[]): Task[] {
  if (!ids || ids.length === 0) return suite.tasks;
  const unknown = ids.filter((id) => !suite.tasks.some((t) => t.id === id));
  if (unknown.length) throw new Error(`unknown task(s): ${unknown.join(", ")}`);
  return suite.tasks.filter((t) => ids.includes(t.id));
}

/** What a run would do, without doing it: `catenet eval run --plan`. */
export function planEval(
  opts: Pick<RunOptions, "trials" | "seed" | "tasks" | "suiteDir">,
  costPerRunUsd: number,
) {
  const suite = loadSuite(opts.suiteDir ?? defaultSuiteDir());
  const tasks = selectTasks(suite, opts.tasks);
  const blocks = makeSchedule(
    tasks.map((t) => t.id),
    opts.trials,
    opts.seed,
  );
  return {
    tasks: tasks.length,
    blocks: blocks.length,
    runs: blocks.length * 2,
    estimatedCostUsd: blocks.length * 2 * costPerRunUsd,
  };
}

function catenetCommit(): string {
  try {
    const head = execFileSync("git", ["-C", checkout(), "rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const dirty = execFileSync("git", ["-C", checkout(), "status", "--porcelain"], {
      encoding: "utf8",
    }).trim();
    return dirty ? `${head}+dirty` : head;
  } catch {
    return "unknown";
  }
}

const catenetCli = (pluginDir: string) => join(pluginDir, "dist", "catenet.mjs");

async function enableCatenet(ws: Workspace, pluginDir: string): Promise<void> {
  const r = await run(process.execPath, [catenetCli(pluginDir), "init", "--repo", ws.repo], {
    cwd: ws.repo,
    env: nodeEnv({ CATENET_RUNTIME_DIR: ws.runtime }),
  });
  if (r.code !== 0) throw new Error(`catenet init failed: ${r.stdout}${r.stderr}`.slice(0, 1000));
}

async function collectCatenet(ws: Workspace, pluginDir: string): Promise<CatenetStats | null> {
  stopDaemonSync(ws, pluginDir);
  const db = join(ws.repo, ".catenet", "events.db");
  if (!existsSync(db)) return null;
  const store = new EventStore(db, { root: ws.repo, upgrade: false });
  try {
    const r = store.report("last");
    if (!r) return null;
    return {
      contextInjections: r.hooks.withContext,
      syncHooks: r.hooks.sync,
      hookP95Ms: r.hooks.p95,
      hookFailures: r.hooks.failures,
    };
  } finally {
    store.close();
  }
}

async function runOne(
  suite: Suite,
  task: Task,
  condition: Condition,
  block: Block,
  opts: RunOptions,
  outDir: string,
): Promise<RunRow> {
  const pluginDir = opts.pluginDir ?? defaultPluginDir();
  const maxAttempts = 1 + (opts.retries ?? 2);
  let last: DriverResult | null = null;
  // What every attempt cost, retries included: the cost cap counts all of it (M4 review).
  let spentUsd = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitOnline(opts);
    const ws = prepareWorkspace(suite);
    active = { ws, pluginDir, catenet: condition === "catenet" };
    let daemonStopped = condition !== "catenet";
    try {
      if (condition === "catenet") await enableCatenet(ws, pluginDir);
      const transcriptPath = join(ws.root, "transcript.jsonl");
      const agent = await opts.driver.run({
        task,
        condition,
        repo: ws.repo,
        pluginDir,
        env: nodeEnv({ CATENET_RUNTIME_DIR: ws.runtime }),
        transcriptPath,
        forbidden: [suite.dir, checkout(), "fixtures/eval-shop", "answer-key", "holdout"],
        forbiddenInResults: ["fixtures/eval-shop", "answer-key", "holdout/"],
      });
      last = agent;
      spentUsd += agent.costUsd ?? 0;
      const stats = condition === "catenet" ? await collectCatenet(ws, pluginDir) : null;
      daemonStopped = true;
      if (opts.keepTranscripts && existsSync(transcriptPath)) {
        mkdirSync(join(outDir, "transcripts"), { recursive: true });
        writeFileSync(
          join(outDir, "transcripts", `${block.index}-${task.id}-${condition}-${attempt}.jsonl`),
          readFileSync(transcriptPath),
        );
      }
      if (agent.status === "error") {
        if (!(await isOnline(opts))) {
          // The network dropped mid-session: not the agent's fault and not a real attempt.
          opts.log?.(`  ${task.id} ${condition}: lost the network; retrying when it is back`);
          attempt--;
          continue;
        }
        opts.log?.(
          `  ${task.id} ${condition}: infrastructure error (attempt ${attempt}): ${agent.error ?? ""}`,
        );
        continue;
      }
      const check = task.kind === "edit" ? await checkEdit(ws.repo, task) : checkQuestion(ws.repo, task);
      return {
        block: block.index,
        trial: block.trial,
        task: task.id,
        kind: task.kind,
        control: task.kind === "edit" && task.dependents.length === 0,
        condition,
        status: agent.invalidReasons.length ? "invalid" : "ok",
        attempts: attempt,
        spentUsd,
        agent,
        check,
        catenet: stats,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.log?.(`  ${task.id} ${condition}: harness error (attempt ${attempt}): ${message}`);
      last = {
        status: "error",
        error: message,
        endReason: null,
        durationMs: 0,
        usage: null,
        tokensTotal: null,
        costUsd: null,
        turns: null,
        toolCalls: {},
        model: null,
        invalidReasons: [],
      };
    } finally {
      // A harness error must not leave the daemon running (it would watch a deleted directory for an hour).
      if (!daemonStopped) stopDaemonSync(ws, pluginDir);
      ws.cleanup();
      active = null;
    }
  }
  return {
    block: block.index,
    trial: block.trial,
    task: task.id,
    kind: task.kind,
    control: task.kind === "edit" && task.dependents.length === 0,
    condition,
    status: "error",
    attempts: maxAttempts,
    spentUsd,
    agent: last as DriverResult,
    check: null,
    catenet: null,
  };
}

export async function runEval(opts: RunOptions): Promise<{ dir: string; report: Report }> {
  const suite = loadSuite(opts.suiteDir ?? defaultSuiteDir());
  const tasks = selectTasks(suite, opts.tasks);
  const now = new Date().toISOString();
  if (opts.resume && !opts.outDir)
    throw new Error("--resume needs the results directory of the run to continue");
  const newId = `${now.replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}-${opts.driver.name}`;
  const dir = opts.outDir ?? join(resultsDir(), newId);
  mkdirSync(dir, { recursive: true });
  const raw = join(dir, "raw.jsonl");
  const metaPath = join(dir, "meta.json");
  const schedule = makeSchedule(
    tasks.map((t) => t.id),
    opts.trials,
    opts.seed,
  );
  let previous: RunRow[] = [];
  let previousMeta: Partial<RunMeta> = {};
  if (!opts.resume && existsSync(raw) && readFileSync(raw, "utf8").trim())
    throw new Error(`${dir} already holds results; use --resume to continue that run, or another --out`);
  if (opts.resume) {
    previous = existsSync(raw) ? readRows(dir) : [];
    previousMeta = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta) : {};
    // The rest of the run must be the same experiment as the part already done (M4 review).
    const changed = [
      previousMeta.driver !== undefined && previousMeta.driver !== opts.driver.name && "driver",
      previousMeta.model !== undefined && previousMeta.model !== opts.model && "model",
      previousMeta.maxTurns !== undefined && previousMeta.maxTurns !== opts.maxTurns && "max turns",
      previousMeta.suite && previousMeta.suite.hash !== suite.hash && "suite",
    ].filter(Boolean);
    if (changed.length)
      throw new Error(`can't resume: the ${changed.join(", ")} changed since this run started`);
    // meta.json (written when a run starts) names the schedule; runs interrupted before that are checked row by row.
    const m = previousMeta;
    if (
      (m.seed !== undefined && m.seed !== opts.seed) ||
      (m.trials !== undefined && m.trials !== opts.trials) ||
      (m.suite && m.suite.taskIds.join(",") !== tasks.map((t) => t.id).join(","))
    )
      throw new Error("these results come from another schedule: check --seed, --trials and --tasks");
    for (const r of previous) {
      const b = schedule[r.block];
      if (!b || b.task !== r.task || b.trial !== r.trial)
        throw new Error("these results come from another schedule: check --seed, --trials and --tasks");
    }
    // Infrastructure errors are run again, not kept: they never measured the agent.
    const errors = previous.filter((r) => r.status === "error").length;
    if (errors) {
      previous = previous.filter((r) => r.status !== "error");
      writeFileSync(raw, previous.map((r) => `${JSON.stringify(r)}\n`).join(""));
      opts.log?.(`resuming: ${errors} infrastructure error(s) will be run again`);
    }
  } else writeFileSync(raw, "");
  const runId = previousMeta.runId ?? (opts.resume ? basename(dir) : newId);
  // A run interrupted before writing meta.json still has its start time in its id (YYYYMMDD-HHMMSS-driver).
  const idTime = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(runId);
  const startedAt =
    previousMeta.startedAt ??
    (opts.resume && idTime
      ? `${idTime[1]}-${idTime[2]}-${idTime[3]}T${idTime[4]}:${idTime[5]}:${idTime[6]}.000Z`
      : now);
  const lock = readLock();
  const meta: RunMeta = {
    runId,
    startedAt,
    resumedAt: [...(previousMeta.resumedAt ?? []), ...(opts.resume ? [now] : [])],
    finishedAt: startedAt,
    driver: opts.driver.name,
    agentVersion: await opts.driver.version(),
    model: opts.model,
    maxTurns: opts.maxTurns,
    catenetCommit: catenetCommit(),
    suite: {
      name: suite.name,
      hash: suite.hash,
      taskIds: tasks.map((t) => t.id),
      allTasks: tasks.length === suite.tasks.length,
    },
    lock: lock
      ? { hash: lock.hash, trials: lock.trials, model: lock.model, maxTurns: lock.maxTurns, seed: lock.seed }
      : null,
    seed: opts.seed,
    trials: opts.trials,
    concurrency: 1,
    maxCostUsd: opts.maxCostUsd,
    stoppedEarly: false,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  const rows: RunRow[] = [...previous];
  const done = new Set(previous.map((r) => `${r.block}|${r.condition}`));
  let cost = previous.reduce((sum, r) => sum + (r.spentUsd ?? r.agent.costUsd ?? 0), 0);
  // Ctrl-C or a kill: stop the current session's daemon and delete its workspace before exiting.
  const onSignal = (signal: NodeJS.Signals) => {
    if (active) {
      if (active.catenet) stopDaemonSync(active.ws, active.pluginDir);
      active.ws.cleanup();
    }
    opts.log?.(`interrupted (${signal}); finished runs are kept, continue with --resume ${dir}`);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  if (opts.resume) opts.log?.(`resuming: ${previous.length} runs already done, $${cost.toFixed(2)} spent`);
  for (const block of schedule) {
    if (block.order.every((c) => done.has(`${block.index}|${c}`))) continue;
    if (cost >= opts.maxCostUsd) {
      meta.stoppedEarly = true;
      opts.log?.(`stopping: agent cost $${cost.toFixed(2)} reached the cap of $${opts.maxCostUsd}`);
      break;
    }
    const task = tasks.find((t) => t.id === block.task) as Task;
    opts.log?.(`block ${block.index + 1}/${schedule.length}: ${task.id} (trial ${block.trial + 1})`);
    for (const condition of block.order) {
      if (done.has(`${block.index}|${condition}`)) continue;
      const row = await runOne(suite, task, condition, block, opts, dir);
      rows.push(row);
      cost += row.spentUsd ?? row.agent.costUsd ?? 0;
      appendFileSync(raw, `${JSON.stringify(row)}\n`);
      opts.log?.(
        `  ${condition}: ${row.status}${row.agent.costUsd ? `, $${row.agent.costUsd.toFixed(3)}` : ""}`,
      );
    }
  }
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
  meta.finishedAt = new Date().toISOString();
  // The versions the sessions themselves reported; more than one makes the run exploratory.
  meta.agentVersions = [
    ...new Set(rows.map((r) => r.agent.agentVersion).filter((v): v is string => typeof v === "string")),
  ].sort();
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  const report = buildReport(rows, meta);
  writeReport(dir, report);
  return { dir, report };
}
