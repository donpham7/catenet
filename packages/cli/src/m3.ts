// M3 commands: `catenet init` (the per-repo consent step) and `catenet report` (a session's record).
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configPath,
  DEFAULT_CONFIG,
  defaultDbPath,
  EventSchemaError,
  EventStore,
  indexRepo,
  isTooBroadForRoot,
  openGraph,
  prepareStateDir,
  type SessionReport,
  sanitizeDeep,
  sanitizeText,
} from "@catenet/core";
import { ensureDaemon } from "@catenet/daemon";
import type { Io } from "./index.js";

/** The Catenet checkout or plugin that contains this CLI: the directory with .claude-plugin/marketplace.json. */
function marketplaceRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, ".claude-plugin", "marketplace.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The plugin's hook entry inside a checkout; it exists only after `pnpm build:plugin`. */
const pluginHook = (market: string) => join(market, "plugins", "claude-code", "dist", "hook.mjs");

export async function initCommand(io: Io, root: string, json: boolean): Promise<number> {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    io.err(`no such directory: ${sanitizeText(root)}`);
    return 1;
  }
  // The hooks walk up from the session's directory to the nearest opted-in folder, so enabling the home directory
  // or the filesystem root would capture every project below it. They also refuse it; refuse it here first.
  if (isTooBroadForRoot(root)) {
    io.err(`refusing to enable Catenet in ${sanitizeText(root)}: run \`catenet init\` inside a repository`);
    return 1;
  }
  // .catenet/ gets its own .gitignore (kept if the user edited it), so nothing touches the repo's own .gitignore.
  prepareStateDir(join(root, ".catenet"));
  if (!existsSync(configPath(root)))
    writeFileSync(configPath(root), `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  let stats: Awaited<ReturnType<typeof indexRepo>> | null = null;
  let indexError: string | null = null;
  try {
    stats = await indexRepo({ root });
  } catch (err) {
    indexError = err instanceof Error ? err.message : String(err);
  }
  const daemon = await ensureDaemon(root);
  const market = marketplaceRoot();
  const pluginBuilt = market !== null && existsSync(pluginHook(market));
  const ok = indexError === null && daemon.status !== "failed";
  if (json) {
    io.out(
      JSON.stringify(sanitizeDeep({ root, index: stats, indexError, daemon, pluginBuilt }, 2000), null, 2),
    );
    return ok ? 0 : 1;
  }
  io.out(`enabled Catenet in ${sanitizeText(root)} (.catenet/ keeps its own .gitignore)`);
  io.out(
    stats
      ? `indexed ${stats.files} files in ${stats.ms.toFixed(0)} ms`
      : `indexing failed: ${sanitizeText(indexError ?? "unknown error")} (fix it, then run \`catenet index\`)`,
  );
  io.out(
    daemon.status === "failed"
      ? `daemon failed to start: ${sanitizeText(daemon.error)} (the graph won't update until \`catenet daemon start\`)`
      : `daemon ${daemon.status} (pid ${daemon.health.pid})`,
  );
  if (market && !pluginBuilt) {
    io.out("the Claude Code plugin isn't built yet; first run, in the Catenet checkout:");
    io.out(`  pnpm build:plugin   (in ${sanitizeText(market)})`);
  }
  io.out("next, in Claude Code:");
  io.out(`  /plugin marketplace add ${market ? sanitizeText(market) : "<path to your Catenet checkout>"}`);
  io.out("  /plugin install catenet@catenet");
  return ok ? 0 : 1;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local time, minute precision; the report says once that times are local. */
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 120
    ? `${s}s`
    : s < 7200
      ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
      : `${(s / 3600).toFixed(1)}h`;
};
const tally = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${sanitizeText(k)} ${n}`)
    .join(", ");

export function reportCommand(io: Io, root: string, selector: string, json: boolean): number {
  const path = join(root, ".catenet", "events.db");
  if (!existsSync(path)) {
    io.out("no sessions recorded yet");
    return 0;
  }
  let store: EventStore;
  try {
    store = new EventStore(path, { root, upgrade: false });
  } catch (err) {
    if (!(err instanceof EventSchemaError)) throw err;
    io.out(sanitizeText(err.message));
    return 0;
  }
  let r: SessionReport | null;
  try {
    r = store.report(selector);
  } finally {
    store.close();
  }
  if (!r) {
    io.out(selector === "last" ? "no sessions recorded yet" : `no session ${sanitizeText(selector)}`);
    return selector === "last" ? 0 : 1;
  }
  const graph = existsSync(defaultDbPath(root)) ? openGraph(defaultDbPath(root)) : null;
  const impact = (file: string) => {
    if (!graph) return "graph not built";
    try {
      const i = graph.impactSummary(file, { fileOnly: true });
      return `${i.direct.length} direct / ${i.transitiveCount} transitive dependents${i.publishedApi ? ", published API" : ""}`;
    } catch {
      return "not in the graph";
    }
  };
  try {
    if (json) {
      io.out(
        JSON.stringify(
          sanitizeDeep({ ...r, diffs: r.diffs.map((d) => ({ ...d, impact: impact(d.path) })) }, 2000),
          null,
          2,
        ),
      );
      return 0;
    }
    const s = r.session;
    io.out(
      `session ${sanitizeText(s.id)} (${sanitizeText(s.agent)}) started ${when(s.startedAt)} local time` +
        (s.endedAt
          ? `, ended (${sanitizeText(s.endReason ?? "?")}) after ${duration(s.endedAt - s.startedAt)}`
          : ", still active") +
        (s.turns ? `, ${s.turns} turns` : ""),
    );
    const meta = [
      s.model ? `model ${sanitizeText(s.model)}` : "",
      s.gitHead ? `git ${s.gitHead.slice(0, 10)}` : "",
    ].filter(Boolean);
    if (meta.length) io.out(meta.join(", "));
    io.out(`prompts (${r.prompts.length}):`);
    for (const p of r.prompts.slice(0, 10)) io.out(`  ${when(p.ts).slice(11)}  ${sanitizeText(p.preview)}`);
    io.out(
      r.toolCalls.total === 0
        ? "tool calls: 0"
        : `tool calls: ${r.toolCalls.total} (${tally(r.toolCalls.byTool)}); outcomes: ${tally(r.toolCalls.byOutcome)}`,
    );
    if (r.diffs.length > 0) {
      io.out("files edited:");
      for (const d of r.diffs) {
        io.out(
          `  ${sanitizeText(d.path)}  +${d.added} -${d.removed} (${d.edits} edit${d.edits === 1 ? "" : "s"})  ${impact(d.path)}${
            d.partial
              ? "  (partial: line counts unavailable; the edit began before Catenet was watching, or a file was skipped)"
              : ""
          }`,
        );
      }
    }
    if (r.compactions > 0) io.out(`compactions: ${r.compactions}`);
    if (r.hooks.count > 0 || r.hooks.failures > 0) {
      const timing =
        r.hooks.sync > 0
          ? `; ${r.hooks.sync} the agent waited for: p50 ${r.hooks.p50} ms, p95 ${r.hooks.p95} ms, max ${r.hooks.max} ms (hook start to daemon answer)`
          : "";
      io.out(
        `hooks: ${r.hooks.count} answered${timing}; ${r.hooks.failures} failed (see .catenet/hook-errors.log)`,
      );
    }
    io.out("decisions: none (the gate arrives in M5)");
    return 0;
  } finally {
    graph?.close();
  }
}

export const resolveRoot = (path: string) => resolve(path);
