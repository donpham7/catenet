// `catenet doctor` (ROADMAP M2): accurate healthy/unhealthy report. Unhealthy = any check fails; warnings don't fail.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultDbPath, EXTRACTOR_VERSION, openGraph, pendingChanges, SCHEMA_VERSION } from "@catenet/core";
import { buildId, daemonStatus, health, socketPath } from "@catenet/daemon";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export type CheckStatus = "ok" | "warn" | "fail";
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}
export interface DoctorReport {
  healthy: boolean;
  root: string;
  checks: Check[];
}

/** The built CLI entry, used for the MCP handshake. Resolves to dist/ from both src/ and dist/. */
const CLI_MAIN = fileURLToPath(new URL("../dist/main.js", import.meta.url));
export const EXPECTED_TOOLS = [
  "find_symbol",
  "get_dependencies",
  "get_dependents",
  "impact_of",
  "repo_map",
  "rescan",
  "tests_for",
];

const ago = (iso: string | null) => {
  if (!iso) return "unknown time";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 120
    ? `${s} s ago`
    : s < 7200
      ? `${Math.round(s / 60)} min ago`
      : `${Math.round(s / 3600)} h ago`;
};

async function mcpHandshake(root: string): Promise<Check> {
  const client = new Client({ name: "catenet-doctor", version: "0.1.0" });
  try {
    if (!existsSync(CLI_MAIN))
      return { name: "mcp", status: "fail", detail: `CLI binary missing (${CLI_MAIN}); run pnpm build` };
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [CLI_MAIN, "mcp", "--repo", root, "--no-daemon"],
        stderr: "ignore",
      }),
    );
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    const missing = EXPECTED_TOOLS.filter((t) => !tools.includes(t));
    return missing.length === 0
      ? { name: "mcp", status: "ok", detail: `stdio handshake ok, ${tools.length} tools` }
      : { name: "mcp", status: "fail", detail: `missing tools: ${missing.join(", ")}` };
  } catch (err) {
    return {
      name: "mcp",
      status: "fail",
      detail: `handshake failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runDoctor(root: string, opts: { mcp?: boolean } = {}): Promise<DoctorReport> {
  const checks: Check[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push(
    nodeMajor >= 24
      ? { name: "node", status: "ok", detail: `Node ${process.versions.node}` }
      : {
          name: "node",
          status: "fail",
          detail: `Node ${process.versions.node}; Catenet needs Node 24+ (ADR-0005)`,
        },
  );

  const dbPath = defaultDbPath(root);
  let graphOk = false;
  if (!existsSync(dbPath)) {
    checks.push({
      name: "graph",
      status: "fail",
      detail: "no graph yet: run `catenet index` (or start the daemon)",
    });
  } else {
    try {
      const g = openGraph(dbPath);
      const info = g.indexInfo();
      g.close();
      if (info.extractorVersion !== EXTRACTOR_VERSION) {
        checks.push({
          name: "graph",
          status: "fail",
          detail: `built by extractor v${info.extractorVersion ?? "?"}, this Catenet is v${EXTRACTOR_VERSION}: run \`catenet index\``,
        });
      } else {
        graphOk = true;
        checks.push({
          name: "graph",
          status: "ok",
          detail: `${info.files} files, schema v${SCHEMA_VERSION}, indexed ${ago(info.indexedAt)}`,
        });
      }
    } catch (err) {
      checks.push({
        name: "graph",
        status: "fail",
        detail: `cannot open graph: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const status = await daemonStatus(root);
  const h = status.health;
  if (!h) {
    checks.push({
      name: "daemon",
      status: "warn",
      detail:
        "not running: the graph won't update until `catenet daemon start` (the MCP server also starts it)",
    });
  } else if (h.lastIndex?.error) {
    checks.push({
      name: "daemon",
      status: "fail",
      detail: `pid ${h.pid}: last index failed: ${h.lastIndex.error}`,
    });
  } else if (h.buildId !== buildId()) {
    checks.push({
      name: "daemon",
      status: "warn",
      detail: `pid ${h.pid} runs an older build; \`catenet daemon start\` replaces it`,
    });
  } else if (!h.watching) {
    checks.push({
      name: "daemon",
      status: "warn",
      detail: `pid ${h.pid} is running but not watching files yet`,
    });
  } else {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await health(socketPath(root), 1000).catch(() => null);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    checks.push({
      name: "daemon",
      status: "ok",
      detail: `pid ${h.pid} watching; health round trip p50 ${(samples[2] ?? 0).toFixed(1)} ms`,
    });
  }

  if (graphOk) {
    let pending: ReturnType<typeof pendingChanges> = null;
    try {
      pending = pendingChanges(root, dbPath);
    } catch (err) {
      const detail = `could not compare with disk: ${err instanceof Error ? err.message : String(err)}`;
      checks.push({ name: "freshness", status: "warn", detail });
    }
    const n = pending ? pending.changed + pending.added + pending.deleted : 0;
    if (pending === null) {
      // Reported above.
    } else if (n === 0)
      checks.push({ name: "freshness", status: "ok", detail: "graph matches the files on disk" });
    else {
      checks.push({
        name: "freshness",
        status: h?.watching ? "ok" : "warn",
        detail: `${pending?.changed} changed, ${pending?.added} added, ${pending?.deleted} deleted since the last index${
          h?.watching ? " (the daemon is catching up)" : ": run `catenet index` or start the daemon"
        }`,
      });
    }
  }

  if (opts.mcp !== false) checks.push(await mcpHandshake(root));
  return { healthy: checks.every((c) => c.status !== "fail"), root, checks };
}
