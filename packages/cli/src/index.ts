// `catenet` CLI (ARCHITECTURE 2.10). Thin: parse args, call @catenet/core, print. Exit codes: 0 ok, 1 usage/state
// error, 2 target error.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { runHook } from "@catenet/adapter-claude-code";
import {
  type Dependent,
  type DependentsResult,
  defaultDbPath,
  findOptedInRoot,
  type Impact,
  indexRepo,
  openGraph,
  sanitizeText,
  TargetError,
} from "@catenet/core";
import { daemonStatus, ensureDaemon, stopDaemon } from "@catenet/daemon";
import { runStdioServer } from "@catenet/mcp";
import { runDoctor } from "./doctor.js";
import { initCommand, reportCommand } from "./m3.js";

export interface Io {
  out(line: string): void;
  err(line: string): void;
  cwd: string;
}

const defaultIo: Io = {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
  cwd: process.cwd(),
};

const HELP = `catenet: read-only code graph for coding agents

Usage:
  catenet index [--full]                 build or update the graph (.catenet/graph.db)
  catenet deps <target> [--depth N]      what the target depends on
  catenet dependents <target> [--depth N]  what depends on the target
  catenet impact <target>                blast radius: dependents, packages, static test coverage, evidence
  catenet daemon start|stop|status       the per-repo daemon that keeps the graph current
  catenet mcp [--no-daemon]              MCP server over stdio (for Claude Code / Codex)
  catenet doctor                         health report; exit 1 if anything is broken
  catenet init                           enable Catenet in this repo (index, daemon, plugin instructions)
  catenet report [--session last|<id>]   what the agent did in a session
  catenet hook <agent>                   hook entry for manual settings (stdin payload; --repo overrides its cwd)

Targets: a file path (src/lib/format.ts), path#Symbol (src/lib/format.ts#formatCurrency) or a symbol name.
Options: --repo <dir> (default: git root, else cwd), --json, --help`;

/** Repo text is untrusted (CLAUDE.md principle 5): see sanitizeText in @catenet/core. */
export const sanitize = (s: string): string => sanitizeText(s);

/**
 * Turn a path target typed relative to the current directory (or absolute, or `./`-prefixed) into the repo-relative
 * form the graph uses. Bare symbol names and paths outside the repo pass through unchanged.
 */
export function normalizeTarget(spec: string, cwd: string, root: string): string {
  const hash = spec.indexOf("#");
  const pathPart = hash >= 0 ? spec.slice(0, hash) : spec;
  const symbolPart = hash >= 0 ? spec.slice(hash) : "";
  const looksLikePath =
    /[\\/]/.test(pathPart) || pathPart.startsWith(".") || /\.[cm]?[jt]sx?$|\.py$/.test(pathPart);
  if (!looksLikePath) return spec;
  const abs = resolve(cwd, pathPart);
  const rel = relative(root, abs).split(sep).join("/");
  if (rel && !rel.startsWith("..") && !isAbsolute(rel) && existsSync(abs)) return `${rel}${symbolPart}`;
  return spec;
}

function repoRoot(io: Io, flag: string | undefined): string {
  if (flag) return resolve(io.cwd, flag);
  try {
    return execFileSync("git", ["-C", io.cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return io.cwd;
  }
}

const mark = (d: Dependent) => `${sanitize(d.file)}${d.confidence === "heuristic" ? "  (heuristic)" : ""}`;

function printDeps(io: Io, verb: string, r: DependentsResult): void {
  const directSet = new Set(r.direct.map((d) => d.file));
  const indirect = r.transitive.filter((d) => !directSet.has(d.file));
  io.out(
    `${verb} ${sanitize(r.target.id)}: ${r.direct.length} direct, ${r.transitive.length} transitive (files)`,
  );
  if (r.direct.length > 0) {
    io.out("direct:");
    for (const d of r.direct) io.out(`  ${mark(d)}`);
  }
  if (indirect.length > 0) {
    io.out("indirect:");
    for (const d of indirect) io.out(`  ${mark(d)}`);
  }
}

function printImpact(io: Io, i: Impact): void {
  const yesNo = (b: boolean) => (b ? "yes" : "no");
  io.out(sanitize(i.target.id));
  io.out(
    `  published API:         ${yesNo(i.publishedApi)}${i.publishedApi ? " (may have dependents outside this repo)" : ""}`,
  );
  io.out(`  direct dependents:     ${i.direct.length} files`);
  io.out(
    `  transitive dependents: ${i.transitive.length} files in ${i.packages.length} package(s)` +
      (i.crossPackage.length > 0 ? `; other packages: ${i.crossPackage.map(sanitize).join(", ")}` : ""),
  );
  io.out(
    `  tests (static):        ${i.tests.covered.length} of ${i.transitive.length} dependents reached by a test; ` +
      `target ${i.tests.targetCovered ? "is" : "is not"} reached by a test`,
  );
  const heuristic = i.transitive.filter((d) => d.confidence === "heuristic").length;
  if (heuristic > 0)
    io.out(`  heuristic:             ${heuristic} dependents are reached only through heuristic edges`);
  if (i.unresolvedImports.length > 0) {
    io.out(`  unresolved imports:    ${i.unresolvedImports.length} in this package may hide dependents:`);
    for (const u of i.unresolvedImports.slice(0, 5)) {
      io.out(`    ${sanitize(u.from)}:${u.lines.join(",")}  ${sanitize(u.specifier)}`);
    }
  }
  if (i.evidence.length > 0) {
    io.out("  direct dependents and why:");
    for (const e of i.evidence) {
      const why = e.edges
        .map(
          (x) =>
            `${x.kind} ${sanitize(x.toKind === "file" ? "(file)" : x.toName)}${x.lines.length ? ` @${x.lines.join(",")}` : ""}`,
        )
        .join("; ");
      io.out(`    ${sanitize(e.file)}  ${why}`);
    }
  }
  if (i.tests.uncovered.length > 0) {
    io.out(
      `  not reached by any test: ${i.tests.uncovered.slice(0, 10).map(sanitize).join(", ")}${i.tests.uncovered.length > 10 ? ", ..." : ""}`,
    );
  }
}

async function daemonCommand(io: Io, root: string, sub: string | undefined, json: boolean): Promise<number> {
  if (sub === "start") {
    const r = await ensureDaemon(root);
    if (json) io.out(JSON.stringify(r, null, 2));
    else if (r.status === "failed") io.err(`daemon failed to start: ${sanitize(r.error)}`);
    else io.out(`daemon ${r.status} (pid ${r.health.pid}) for ${sanitize(root)}`);
    return r.status === "failed" ? 1 : 0;
  }
  if (sub === "stop") {
    const result = await stopDaemon(root);
    if (json) io.out(JSON.stringify({ result }));
    else
      io.out(
        result === "stopped"
          ? "daemon stopped"
          : result === "not-running"
            ? "no daemon was running"
            : "daemon did not stop",
      );
    return result === "still-running" ? 1 : 0;
  }
  if (sub === "status") {
    const s = await daemonStatus(root);
    if (json) io.out(JSON.stringify(s, null, 2));
    else if (!s.health) io.out("daemon not running");
    else {
      const last = s.health.lastIndex;
      io.out(
        `daemon running: pid ${s.health.pid}, ${s.health.watching ? "watching" : "not watching yet"}, since ${s.health.startedAt}`,
      );
      if (last)
        io.out(
          `last index: ${last.at} (${last.mode}, ${last.ms} ms${last.error ? `, error: ${sanitize(last.error)}` : ""})`,
        );
    }
    return 0;
  }
  io.err("usage: catenet daemon start|stop|status");
  return 1;
}

export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  const OPTIONS = {
    repo: { type: "string" },
    full: { type: "boolean" },
    json: { type: "boolean" },
    depth: { type: "string" },
    help: { type: "boolean", short: "h" },
    "no-daemon": { type: "boolean" },
    session: { type: "string" },
  } as const;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    io.err((err as Error).message);
    io.err(HELP);
    return 1;
  }
  const { values, positionals } = parsed;
  const [command, target] = positionals;
  if (values.help || !command) {
    io.out(HELP);
    return command || values.help ? 0 : 1;
  }
  if (command === "hook") {
    // The hook client finds the repository itself, from the payload's cwd (or --repo), like the plugin's hook.
    let stdin = "";
    for await (const chunk of process.stdin) stdin += chunk;
    let out = "";
    await runHook(target ?? "claude-code", {
      stdin,
      env: process.env,
      write: (t) => {
        out += t;
      },
      startedAt: performance.timeOrigin,
      ...(values.repo ? { startDir: resolve(io.cwd, values.repo) } : {}),
    });
    if (out) process.stdout.write(out);
    return 0;
  }
  if (values.repo && !existsSync(resolve(io.cwd, values.repo))) {
    io.err(`no such directory: ${sanitize(values.repo)}`);
    return 1;
  }
  // Claude Code tells MCP servers the project directory (ADR-0015). The session may start in a subdirectory, so the
  // root is the opted-in repository containing it, found the same way the hooks find it.
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  const root =
    command === "mcp" && !values.repo
      ? (findOptedInRoot(projectDir ?? io.cwd) ??
        repoRoot({ ...io, cwd: resolve(projectDir ?? io.cwd) }, undefined))
      : repoRoot(io, values.repo);
  const dbPath = defaultDbPath(root);
  const depth = values.depth === undefined ? undefined : Number(values.depth);
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 1)) {
    io.err("--depth must be a positive integer");
    return 1;
  }

  if (command === "mcp") {
    // stdout carries JSON-RPC from here on: nothing else may print to it.
    await runStdioServer({ root, daemon: values["no-daemon"] !== true });
    return 0;
  }

  if (command === "daemon") return daemonCommand(io, root, target, values.json === true);

  if (command === "init") return initCommand(io, root, values.json === true);
  if (command === "report") return reportCommand(io, root, values.session ?? "last", values.json === true);
  if (command === "doctor") {
    const report = await runDoctor(root);
    if (values.json) io.out(JSON.stringify(report, null, 2));
    else {
      const icon = { ok: "ok  ", warn: "warn", fail: "FAIL" } as const;
      for (const c of report.checks) io.out(`${icon[c.status]}  ${c.name}: ${sanitize(c.detail)}`);
      io.out(report.healthy ? "healthy" : "unhealthy");
    }
    return report.healthy ? 0 : 1;
  }

  if (command === "index") {
    const stats = await indexRepo({ root, dbPath, full: values.full === true });
    if (values.json) io.out(JSON.stringify(stats, null, 2));
    else {
      io.out(
        `indexed ${stats.files} files in ${stats.ms.toFixed(0)} ms (${stats.mode}; parsed ${stats.extracted}, resolved ${stats.resolved})`,
      );
      if (stats.parseErrorFiles.length > 0) {
        io.out(
          `warning: ${stats.parseErrorFiles.length} file(s) did not fully parse; their edges may be incomplete:`,
        );
        for (const f of stats.parseErrorFiles.slice(0, 10)) io.out(`  ${sanitize(f)}`);
      }
    }
    return 0;
  }

  if (!["deps", "dependents", "impact"].includes(command)) {
    io.err(`unknown command: ${sanitize(command)}`);
    io.err(HELP);
    return 1;
  }
  if (!target) {
    io.err(`usage: catenet ${command} <target>`);
    return 1;
  }
  if (!existsSync(dbPath)) {
    io.err(`no graph at ${dbPath}: run \`catenet index\` first`);
    return 1;
  }
  const graph = openGraph(dbPath);
  try {
    if (command === "impact") {
      const impact = graph.impact(normalizeTarget(target, io.cwd, root));
      if (values.json) io.out(JSON.stringify(impact, null, 2));
      else printImpact(io, impact);
    } else {
      const result =
        command === "deps"
          ? graph.dependencies(normalizeTarget(target, io.cwd, root), { depth })
          : graph.dependents(normalizeTarget(target, io.cwd, root), { depth });
      if (values.json) io.out(JSON.stringify(result, null, 2));
      else printDeps(io, command === "deps" ? "dependencies of" : "dependents of", result);
    }
    return 0;
  } catch (err) {
    if (err instanceof TargetError) {
      io.err(sanitize(err.message));
      if (err.candidates.length > 0) {
        io.err("candidates:");
        for (const c of err.candidates.slice(0, 20)) io.err(`  ${sanitize(c)}`);
      }
      return 2;
    }
    throw err;
  } finally {
    graph.close();
  }
}
