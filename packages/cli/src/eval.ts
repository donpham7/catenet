// `catenet eval run|report|lock` (ROADMAP M4). The harness is loaded only for this command, so other commands
// (hooks, MCP) never pay for it.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./index.js";

export const EVAL_HELP = `catenet eval: run the benchmark (packages/eval/README.md)

Usage:
  catenet eval run [options]     run the pre-registered tasks with and without Catenet
  catenet eval report <dir>      rebuild report.json and report.md from a results directory
  catenet eval lock [options]    pre-register: record the suite hash and run parameters

Options for run:
  --driver claude-code|patch     claude-code (default) runs real sessions; patch applies canned patches (free self-test)
  --patch correct|breaks-dependents|none   which patch the patch driver applies (default correct)
  --trials N --seed N --model ID --max-turns N   default: the pre-registration lock, else 10, 1, claude-sonnet-5-5, 40
  --tasks a,b                    run only these tasks (the report is then exploratory)
  --max-cost-usd N               stop between blocks once agent cost reaches N (default 50)
  --plan                         print the run count and an estimated cost; run nothing
  --cost-per-run N               the per-session cost used by --plan (default 0.30)
  --resume <dir>                 continue an interrupted run (same --seed, --trials and --tasks)
  --out <dir> --plugin-dir <dir> --keep-transcripts`;

export async function evalCommand(io: Io, argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  function parse() {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        driver: { type: "string" },
        patch: { type: "string" },
        trials: { type: "string" },
        seed: { type: "string" },
        model: { type: "string" },
        "max-turns": { type: "string" },
        tasks: { type: "string" },
        "max-cost-usd": { type: "string" },
        plan: { type: "boolean" },
        "cost-per-run": { type: "string" },
        out: { type: "string" },
        "plugin-dir": { type: "string" },
        "keep-transcripts": { type: "boolean" },
        resume: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  }
  try {
    parsed = parse();
  } catch (err) {
    io.err((err as Error).message);
    io.err(EVAL_HELP);
    return 1;
  }
  const { values, positionals } = parsed;
  const [sub, target] = positionals;
  if (values.help || !sub) {
    io.out(EVAL_HELP);
    return values.help ? 0 : 1;
  }
  const ev = await import("@catenet/eval");
  const int = (name: string, v: string | undefined, fallback: number): number => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
    return n;
  };

  try {
    if (sub === "report") {
      if (!target) {
        io.err("usage: catenet eval report <results dir>");
        return 1;
      }
      const dir = resolve(io.cwd, target);
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Parameters<
        typeof ev.buildReport
      >[1];
      const report = ev.buildReport(ev.readRows(dir), meta);
      ev.writeReport(dir, report);
      io.out(`report: ${join(dir, "report.md")}`);
      return 0;
    }

    const lock = ev.readLock();
    const trials = int("trials", values.trials, lock?.trials ?? 10);
    const seed = int("seed", values.seed, lock?.seed ?? 1);
    const model = values.model ?? lock?.model ?? "claude-sonnet-5-5";
    const maxTurns = int("max-turns", values["max-turns"], lock?.maxTurns ?? 40);

    if (sub === "lock") {
      const written = ev.writeLock({ trials, model, maxTurns, seed });
      io.out(
        `pre-registered ${written.suite} ${written.hash.slice(0, 12)}: ${trials} trials, ${model}, max turns ${maxTurns}, seed ${seed}`,
      );
      return 0;
    }
    if (sub !== "run") {
      io.err(`unknown eval command: ${sub}`);
      io.err(EVAL_HELP);
      return 1;
    }

    const tasks = values.tasks
      ? values.tasks
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
    if (values.plan) {
      const plan = ev.planEval({ trials, seed, tasks }, int("cost-per-run", values["cost-per-run"], 0.3));
      io.out(
        `${plan.tasks} tasks × ${trials} trials = ${plan.blocks} blocks, ${plan.runs} sessions; estimated cost $${plan.estimatedCostUsd.toFixed(2)} (cap $${int("max-cost-usd", values["max-cost-usd"], 50)})`,
      );
      return 0;
    }
    const driverName = values.driver ?? "claude-code";
    if (driverName !== "claude-code" && driverName !== "patch")
      throw new Error(`unknown driver ${driverName}`);
    const patch = (values.patch ?? "correct") as "correct" | "breaks-dependents" | "none";
    if (!["correct", "breaks-dependents", "none"].includes(patch)) throw new Error(`unknown patch ${patch}`);
    const pluginDir = values["plugin-dir"] ? resolve(io.cwd, values["plugin-dir"]) : ev.defaultPluginDir();
    if (!existsSync(join(pluginDir, "dist", "catenet.mjs"))) {
      io.err(`the plugin isn't built (${join(pluginDir, "dist")}); run \`pnpm build:plugin\` first`);
      return 1;
    }
    const driver =
      driverName === "patch" ? ev.createPatchDriver(patch) : ev.createClaudeCodeDriver({ model, maxTurns });
    const { dir, report } = await ev.runEval({
      driver,
      trials,
      seed,
      tasks,
      model: driverName === "patch" ? null : model,
      maxTurns: driverName === "patch" ? null : maxTurns,
      maxCostUsd: int("max-cost-usd", values["max-cost-usd"], 50),
      outDir: values.resume
        ? resolve(io.cwd, values.resume)
        : values.out
          ? resolve(io.cwd, values.out)
          : undefined,
      resume: values.resume !== undefined,
      pluginDir,
      keepTranscripts: values["keep-transcripts"] === true,
      log: (l) => io.out(l),
    });
    io.out(
      `${report.counts.runs} runs (${report.counts.ok} ok, ${report.counts.invalid} invalid, ${report.counts.error} errors)${report.exploratory ? "; exploratory" : ""}`,
    );
    io.out(`report: ${join(dir, "report.md")}`);
    return report.counts.error > 0 && report.counts.ok === 0 ? 1 : 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
