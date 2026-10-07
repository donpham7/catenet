// M3 CLI: init (consent step), report, and the MCP opt-in rule.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "@catenet/core";
import { stopDaemon } from "@catenet/daemon";
import { afterAll, describe, expect, it } from "vitest";
import { type Io, main } from "../src/index.js";

const tmp = mkdtempSync(join(tmpdir(), "cn3-"));
const repo = join(tmp, "repo");
cpSync(join(import.meta.dirname, "../../../fixtures/ts-basic/repo"), repo, {
  recursive: true,
  filter: (src) => !src.split(/[\\/]/).includes(".catenet"),
});
const savedRuntime = process.env.CATENET_RUNTIME_DIR;
process.env.CATENET_RUNTIME_DIR = join(tmp, "run");
afterAll(async () => {
  await stopDaemon(repo);
  process.env.CATENET_RUNTIME_DIR = savedRuntime;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), cwd: tmp };
  const code = await main([...argv, "--repo", repo], io);
  return { code, out, err };
}

describe("catenet init", () => {
  it("creates .catenet with its own .gitignore and config, indexes, and starts the daemon", async () => {
    const r = await run("init");
    expect(r.code).toBe(0);
    expect(readFileSync(join(repo, ".catenet/.gitignore"), "utf8")).toBe("*\n!policy.yaml\n");
    expect(JSON.parse(readFileSync(join(repo, ".catenet/config.json"), "utf8"))).toEqual({
      inject: { sessionStart: true, beforeEdit: true },
      retentionDays: 30,
    });
    expect(existsSync(join(repo, ".catenet/graph.db"))).toBe(true);
    const text = r.out.join("\n");
    expect(text).toContain("indexed 23 files");
    expect(text).toMatch(/daemon (started|running)/);
    expect(text).toContain("/plugin marketplace add");
  });

  it("leaves git status clean: nothing under .catenet/ is tracked or listed", async () => {
    const { execFileSync } = await import("node:child_process");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    git("init", "-q");
    expect(git("status", "--porcelain", "--untracked-files=all", "--", ".catenet")).toBe("");
  });

  it("is idempotent and keeps an edited config and .gitignore", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repo, ".catenet/config.json"), JSON.stringify({ inject: { beforeEdit: false } }));
    writeFileSync(join(repo, ".catenet/.gitignore"), "*\n!policy.yaml\n!rules/\n");
    expect((await run("init")).code).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, ".catenet/config.json"), "utf8"))).toEqual({
      inject: { beforeEdit: false },
    });
    expect(readFileSync(join(repo, ".catenet/.gitignore"), "utf8")).toBe("*\n!policy.yaml\n!rules/\n");
  });

  it("refuses a directory that doesn't exist, and the home directory", async () => {
    const io: Io = { out: () => {}, err: () => {}, cwd: tmp };
    expect(await main(["init", "--repo", join(tmp, "no-such-dir")], io)).toBe(1);
    expect(existsSync(join(tmp, "no-such-dir"))).toBe(false);
    const err: string[] = [];
    const { homedir } = await import("node:os");
    expect(await main(["init", "--repo", homedir()], { ...io, err: (l) => err.push(l) })).toBe(1);
    expect(err.join("\n")).toContain("refusing to enable Catenet");
    expect(existsSync(join(homedir(), ".catenet/config.json"))).toBe(false);
  });

  it("reports an indexing failure in one line instead of crashing", async () => {
    const { chmodSync, mkdirSync, writeFileSync } = await import("node:fs");
    const broken = join(tmp, "broken");
    mkdirSync(join(broken, "src"), { recursive: true });
    writeFileSync(join(broken, "src/ok.ts"), "export const ok = 1;\n");
    writeFileSync(join(broken, "src/locked.ts"), "export const locked = 1;\n");
    chmodSync(join(broken, "src/locked.ts"), 0o000);
    const out: string[] = [];
    const code = await main(["init", "--repo", broken], {
      out: (l) => out.push(l),
      err: (l) => out.push(l),
      cwd: tmp,
    });
    chmodSync(join(broken, "src/locked.ts"), 0o644);
    await stopDaemon(broken);
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/indexing failed: .*EACCES/);
    expect(existsSync(join(broken, ".catenet/config.json"))).toBe(true); // still opted in; `catenet index` retries
  });
});

describe("catenet report", () => {
  it("says when nothing has been recorded", async () => {
    const r = await run("report");
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe("no sessions recorded yet");
  });

  it("summarises the last session with edit impact", async () => {
    const store = new EventStore(join(repo, ".catenet/events.db"));
    const base = { agent: "claude-code" as const, sessionId: "sess-1", cwd: repo };
    store.record({
      ...base,
      ts: Date.parse("2026-10-07T10:00:00Z"),
      type: "session_start",
      source: "startup",
    });
    store.record({
      ...base,
      ts: Date.parse("2026-10-07T10:00:05Z"),
      type: "prompt",
      text: "simplify formatCurrency",
    });
    store.record({
      ...base,
      ts: Date.parse("2026-10-07T10:00:10Z"),
      type: "tool_call_end",
      toolUseId: "t1",
      tool: "Edit",
      input: { file_path: join(repo, "src/lib/format.ts") },
      outcome: "succeeded",
    });
    store.recordDiff({
      ...base,
      ts: Date.parse("2026-10-07T10:00:10Z"),
      toolUseId: "t1",
      path: "src/lib/format.ts",
      added: 4,
      removed: 2,
      hashBefore: "a",
      hashAfter: "b",
      partial: false,
    });
    store.recordHookCall({
      ...base,
      ts: Date.parse("2026-10-07T10:00:10Z"),
      event: "PreToolUse",
      sync: true,
      ms: 45,
    });
    store.record({ ...base, ts: Date.parse("2026-10-07T10:03:00Z"), type: "session_end", reason: "other" });
    store.close();

    const r = await run("report");
    expect(r.code).toBe(0);
    const text = r.out.join("\n");
    expect(text).toContain("session sess-1 (claude-code)");
    expect(text).toContain("simplify formatCurrency");
    expect(text).toContain("tool calls: 1 (Edit 1); outcomes: succeeded 1");
    expect(text).toMatch(
      /src\/lib\/format\.ts\s+\+4 -2 \(1 edit\)\s+8 direct \/ 11 transitive dependents, published API/,
    );
    expect(text).toContain(
      "hooks: 1 answered; 1 the agent waited for: p50 45 ms, p95 45 ms, max 45 ms (hook start to daemon answer); 0 failed",
    );
    const json = JSON.parse((await run("report", "--json")).out.join("\n")) as { session: { id: string } };
    expect(json.session.id).toBe("sess-1");
  });
});
