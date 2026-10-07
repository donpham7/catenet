// The MCP server as an agent sees it: spawned over stdio through the real `catenet mcp` command (ROADMAP M2).
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { indexRepo } from "@catenet/core";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const CLI = join(ROOT, "packages/cli/dist/main.js");
const temps: string[] = [];
const clients: Client[] = [];
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => {});
  for (const t of temps) rmSync(t, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function repoFrom(files: Record<string, string> | { fixture: string }): string {
  const tmp = mkdtempSync(join(tmpdir(), "cnm-"));
  temps.push(tmp);
  const root = join(tmp, "repo");
  if ("fixture" in files) {
    cpSync(join(ROOT, "fixtures", files.fixture as string, "repo"), root, {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).includes(".catenet"),
    });
  } else {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
  }
  return root;
}

async function connect(root: string): Promise<Client> {
  const client = new Client({ name: "catenet-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp", "--repo", root, "--no-daemon"],
      stderr: "ignore",
    }),
  );
  clients.push(client);
  return client;
}

async function callJson(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return {
    isError: r.isError === true,
    raw: content[0]?.text ?? "",
    // biome-ignore lint/suspicious/noExplicitAny: assertions walk dynamic tool JSON; the shape is what's under test
    json: JSON.parse(content[0]?.text ?? "{}") as Record<string, any>,
  };
}

describe("catenet MCP server", async () => {
  const root = repoFrom({ fixture: "ts-basic" });
  await indexRepo({ root, full: true });
  const client = await connect(root);

  it("exposes exactly the M2 tools", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      "find_symbol",
      "get_dependencies",
      "get_dependents",
      "impact_of",
      "repo_map",
      "rescan",
      "tests_for",
    ]);
  });

  it("get_dependents matches the answer key", async () => {
    const { json } = await callJson(client, "get_dependents", { target: "src/lib/format.ts" });
    expect(json.counts).toEqual({ direct: 8, transitive: 11 });
    expect(json.direct.map((d: { file: string }) => d.file)).toContain("src/checkout/total.ts");
    expect(json.freshness.daemon).toBe("not running");
    expect(Number.isNaN(Date.parse(json.freshness.indexedAt))).toBe(false);
  });

  it("impact_of, tests_for, find_symbol, get_dependencies and repo_map answer structural questions", async () => {
    const impact = (await callJson(client, "impact_of", { target: "src/lib/format.ts" })).json;
    expect(impact).toMatchObject({ publishedApi: true, counts: { direct: 8, transitive: 11 } });
    expect(impact.tests).toMatchObject({
      kind: "static",
      targetReachedByTest: true,
      dependentsReachedByTest: 2,
    });
    expect(impact.unresolvedImports).toHaveLength(1);
    expect((await callJson(client, "tests_for", { target: "src/lib/format.ts" })).json.tests).toEqual([
      "test/format.test.ts",
    ]);
    expect((await callJson(client, "find_symbol", { name: "formatCurrency" })).json.matches).toEqual([
      { id: "src/lib/format.ts#formatCurrency", kind: "function", line: 3 },
    ]);
    const deps = (await callJson(client, "get_dependencies", { target: "src/checkout/receipt.ts" })).json;
    expect(deps.direct.map((d: { file: string }) => d.file)).toEqual([
      "src/checkout/receipt-format.ts",
      "src/checkout/total.ts",
    ]);
    const map = (await callJson(client, "repo_map", {})).json;
    expect(map.packages).toEqual([{ path: ".", name: "ts-basic-lib", published: true, files: 23 }]);
    expect(map.entryPoints).toEqual([{ package: "ts-basic-lib", file: "src/index.ts" }]);
  });

  it("is deterministic: the same call returns byte-identical JSON", async () => {
    const a = await callJson(client, "impact_of", { target: "src/lib/math.ts" });
    const b = await callJson(client, "impact_of", { target: "src/lib/math.ts" });
    expect(a.raw).toBe(b.raw);
  });

  it("bounds responses and says how to narrow them", async () => {
    const { json } = await callJson(client, "get_dependents", { target: "src/lib/format.ts", limit: 2 });
    expect(json.direct).toHaveLength(2);
    expect(json.truncated).toBe(true);
    expect(json.hint).toContain("raise limit");
    const tooBig = await client.callTool({
      name: "get_dependents",
      arguments: { target: "src/lib/format.ts", limit: 1000 },
    });
    expect(tooBig.isError).toBe(true);
  });

  it("reports unknown and ambiguous targets as errors with candidates", async () => {
    const r = await callJson(client, "impact_of", { target: "src/lib/format.ts#nope" });
    expect(r.isError).toBe(true);
    expect(r.json.candidates).toContain("src/lib/format.ts#formatCurrency");
  });

  it("rescan without a daemon indexes in-process", async () => {
    const { json } = await callJson(client, "rescan", {});
    expect(json).toMatchObject({ via: "in-process", mode: "noop", files: 23 });
  });

  it("sanitises repo-derived text (file names with control characters)", async () => {
    const evil = repoFrom({
      "src/evil\u001b[31m.ts": "export function f(): number {\n  return 1;\n}\n",
      "src/use.ts": 'import { f } from "./evil\u001b[31m";\nexport const x = f();\n',
    });
    await indexRepo({ root: evil, full: true });
    const c = await connect(evil);
    const { raw, json } = await callJson(c, "get_dependencies", { target: "src/use.ts" });
    expect(raw).not.toContain("\u001b");
    expect(raw).not.toContain("\\u001b");
    expect(json.direct[0].file).toBe("src/evil.ts"); // the whole ESC[31m sequence is removed
  });

  it("says when the repository has not been indexed yet", async () => {
    const fresh = repoFrom({ "a.ts": "export const a = 1;\n" });
    const c = await connect(fresh);
    const r = await callJson(c, "get_dependents", { target: "a.ts" });
    expect(r.isError).toBe(true);
    expect(r.json.error).toContain("not been indexed");
    expect(r.json.error).toContain("rescan");
    expect(r.json.error).not.toContain("has been started"); // nothing starts without a daemon (M2 review #7)
  });
});
