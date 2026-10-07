// The Claude Code plugin bundle must work from a copy in an unrelated directory, exactly as when Claude Code copies a
// plugin into its cache (ADR-0015). The bundle is built by the test global setup (scripts/vitest-build.ts) into its own
// directory; the manifests come from plugins/claude-code.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "../../../plugins/claude-code");
/** TEST_PLUGIN_DIST in scripts/vitest-build.ts. */
const TEST_PLUGIN_DIST = join(import.meta.dirname, "../../../node_modules/.cache/catenet/plugin-test/dist");
/** The placeholder Claude Code substitutes in plugin hook and MCP commands. */
const PLUGIN_ROOT_VAR = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");
const tmp = mkdtempSync(join(tmpdir(), "cnp-"));
const plugin = join(tmp, "plugins-cache/catenet/catenet/0.1.0");
const repo = join(tmp, "repo");
const env = { ...process.env, CATENET_RUNTIME_DIR: join(tmp, "run") };
cpSync(SOURCE, plugin, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes("dist") });
cpSync(TEST_PLUGIN_DIST, join(plugin, "dist"), { recursive: true });
cpSync(join(import.meta.dirname, "../../../fixtures/ts-basic/repo"), repo, {
  recursive: true,
  filter: (src) => !src.split(/[\\/]/).includes(".catenet"),
});
mkdirSync(env.CATENET_RUNTIME_DIR, { recursive: true });
const catenet = (...args: string[]) =>
  spawnSync(process.execPath, [join(plugin, "dist/catenet.mjs"), ...args, "--repo", repo], {
    encoding: "utf8",
    env,
  });

afterAll(() => {
  catenet("daemon", "stop");
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function hook(payload: unknown): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(plugin, "dist/hook.mjs"), "claude-code"], { env });
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("plugin bundle from a copied directory", () => {
  it("manifests reference files that exist in the plugin", () => {
    const hooks = JSON.parse(readFileSync(join(plugin, "hooks/hooks.json"), "utf8")) as {
      hooks: Record<string, { hooks: { args: string[] }[] }[]>;
    };
    for (const groups of Object.values(hooks.hooks)) {
      for (const g of groups)
        for (const h of g.hooks)
          expect(existsSync(h.args[0]?.replace(PLUGIN_ROOT_VAR, plugin) ?? "")).toBe(true);
    }
    const mcp = JSON.parse(readFileSync(join(plugin, ".mcp.json"), "utf8")) as {
      mcpServers: { catenet: { args: string[] } };
    };
    expect(existsSync(mcp.mcpServers.catenet.args[0]?.replace(PLUGIN_ROOT_VAR, plugin) ?? "")).toBe(true);
    const market = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../.claude-plugin/marketplace.json"), "utf8"),
    ) as {
      plugins: { source: string }[];
    };
    expect(
      existsSync(
        join(
          import.meta.dirname,
          "../../..",
          market.plugins[0]?.source ?? "missing",
          ".claude-plugin/plugin.json",
        ),
      ),
    ).toBe(true);
  });

  it("init indexes with the bundled grammars and starts the bundled daemon", () => {
    const r = catenet("init");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("indexed 23 files");
    expect(r.stdout).toMatch(/daemon (started|running)/);
  });

  it("the hook client returns context from the bundled daemon", async () => {
    const r = await hook({
      session_id: "s1",
      cwd: repo,
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: join(repo, "src/lib/format.ts") },
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain(
      "8 files depend on it directly",
    );
  });

  it("the bundled MCP server answers, rooted at CLAUDE_PROJECT_DIR", async () => {
    const client = new Client({ name: "plugin-test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(plugin, "dist/catenet.mjs"), "mcp"],
        env: { ...env, CLAUDE_PROJECT_DIR: repo } as Record<string, string>,
        stderr: "ignore",
      }),
    );
    try {
      expect((await client.listTools()).tools).toHaveLength(7);
      const r = await client.callTool({ name: "get_dependents", arguments: { target: "src/lib/format.ts" } });
      expect(JSON.parse((r.content as { text: string }[])[0]?.text ?? "{}").counts).toEqual({
        direct: 8,
        transitive: 11,
      });
    } finally {
      await client.close();
    }
  });

  it("doctor is healthy when run from the bundle", () => {
    const r = catenet("doctor");
    expect(r.stdout).toContain("healthy");
    expect(r.status).toBe(0);
  });
});
