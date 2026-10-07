// Fault injection (ROADMAP M3): the hook process must exit 0, print nothing but a valid response, and stay within its
// time cap whatever goes wrong. These run the real built binary, as Claude Code would.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexRepo } from "@catenet/core";
import { afterEach, describe, expect, it } from "vitest";
import { createDaemon, stopDaemon } from "../src/index.js";

const HOOK = join(import.meta.dirname, "../../adapters/claude-code/dist/hook.js");
const FIXTURE = join(import.meta.dirname, "../../../fixtures/ts-basic/repo");
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tempRepo(optIn: boolean): { root: string; run: string } {
  const tmp = mkdtempSync(join(tmpdir(), "cnh-"));
  cleanups.push(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = join(tmp, "repo");
  cpSync(FIXTURE, root, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes(".catenet") });
  if (optIn) {
    mkdirSync(join(root, ".catenet"), { recursive: true });
    writeFileSync(join(root, ".catenet/config.json"), "{}\n");
  }
  const run = join(tmp, "run");
  mkdirSync(run);
  return { root, run };
}

/** Async on purpose: an in-process daemon (happy-path test) must keep serving while the hook runs. */
function runHook(
  payload: unknown,
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK, "claude-code"], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: performance.now() - t0 }));
    child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

const pre = (root: string, file = "src/lib/format.ts") => ({
  session_id: "s1",
  cwd: root,
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  tool_use_id: "t1",
  tool_input: { file_path: join(root, file) },
});

let fakeCount = 0;
async function fakeSocket(root: string, run: string, handler: RequestListener): Promise<void> {
  const socket = join(run, `fake-${++fakeCount}.sock`);
  const server: Server = createServer(handler);
  await new Promise<void>((r) => server.listen(socket, () => r()));
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  writeFileSync(join(root, ".catenet", "daemon.json"), JSON.stringify({ pid: process.pid, socket }));
}

describe("hook client fault injection", () => {
  it("does nothing in a repo that hasn't opted in", async () => {
    const { root } = tempRepo(false);
    const r = await runHook(pre(root));
    expect(r).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(existsSync(join(root, ".catenet"))).toBe(false);
  });

  it("daemon down: exits 0, prints nothing, logs the miss", async () => {
    const { root } = tempRepo(true);
    const r = await runHook(pre(root));
    expect(r).toMatchObject({ code: 0, stdout: "" });
    // One tab-separated line per failure, with the session id, so `catenet report` can count it.
    expect(readFileSync(join(root, ".catenet/hook-errors.log"), "utf8")).toMatch(/\tPreToolUse\ts1\t/);
  });

  it("SessionStart against a slow daemon logs the miss and starts no second daemon", async () => {
    const { root, run } = tempRepo(true);
    await fakeSocket(root, run, () => {}); // a live daemon that is busy: accepts, never answers
    const marker = join(run, "spawned");
    const fakeMain = join(run, "fake-daemon.mjs");
    writeFileSync(
      fakeMain,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "x");\n`,
    );
    const r = await runHook(
      { session_id: "s1", cwd: root, hook_event_name: "SessionStart", source: "startup" },
      { CATENET_DAEMON_MAIN: fakeMain },
    );
    expect(r).toMatchObject({ code: 0, stdout: "" });
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(root, ".catenet/hook-errors.log"), "utf8")).toContain(
      "no answer within 2000 ms",
    );
  });

  it("logs a non-200 answer (e.g. a daemon from an older build without /hook)", async () => {
    const { root, run } = tempRepo(true);
    await fakeSocket(root, run, (_req, res) => {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
    expect(await runHook(pre(root))).toMatchObject({ code: 0, stdout: "" });
    expect(readFileSync(join(root, ".catenet/hook-errors.log"), "utf8")).toContain("HTTP 404");
  });

  it("never sends tool output or the model's reply to the daemon", async () => {
    const { root, run } = tempRepo(true);
    let received = "";
    await fakeSocket(root, run, (req, res) => {
      req.on("data", (c: Buffer) => {
        received += c.toString();
      });
      req.on("end", () => res.end(JSON.stringify({ output: "" })));
    });
    await runHook({
      ...pre(root),
      hook_event_name: "PostToolUse",
      tool_response: { content: "FILE-CONTENTS" },
      last_assistant_message: "REPLY",
    });
    expect(received).toContain('"PostToolUse"');
    expect(received).not.toContain("FILE-CONTENTS");
    expect(received).not.toContain("REPLY");
  });

  it("rotates a large error log instead of growing it forever", async () => {
    const { root } = tempRepo(true);
    writeFileSync(join(root, ".catenet/hook-errors.log"), "x".repeat(600 * 1024));
    await runHook(pre(root));
    expect(existsSync(join(root, ".catenet/hook-errors.log.1"))).toBe(true);
    expect(
      readFileSync(join(root, ".catenet/hook-errors.log"), "utf8").split("\n").filter(Boolean),
    ).toHaveLength(1);
  });

  it("treats a .catenet folder without config.json as not opted in", async () => {
    const { root } = tempRepo(false);
    mkdirSync(join(root, ".catenet")); // e.g. left by `catenet index`, or committed by the repository
    expect(await runHook(pre(root))).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(existsSync(join(root, ".catenet/hook-errors.log"))).toBe(false);
  });

  it("slow daemon: gives up within the PreToolUse cap", async () => {
    const { root, run } = tempRepo(true);
    await fakeSocket(root, run, () => {}); // accepts, never answers
    const r = await runHook(pre(root));
    expect(r).toMatchObject({ code: 0, stdout: "" });
    expect(r.ms).toBeLessThan(1500); // 250 ms cap + Node start-up, with headroom for a loaded machine
    expect(readFileSync(join(root, ".catenet/hook-errors.log"), "utf8")).toContain("no answer within 250 ms");
  });

  it("garbage from the daemon is never forwarded to the agent", async () => {
    const { root, run } = tempRepo(true);
    await fakeSocket(root, run, (_req, res) => res.end("<html>not json</html>"));
    expect(await runHook(pre(root))).toMatchObject({ code: 0, stdout: "" });
    await fakeSocket(root, run, (_req, res) =>
      res.end(JSON.stringify({ output: "plain text, not a hook response" })),
    );
    expect(await runHook(pre(root))).toMatchObject({ code: 0, stdout: "" });
  });

  it("malformed stdin exits 0 silently", async () => {
    tempRepo(true);
    expect(await runHook("{{{ not json")).toMatchObject({ code: 0, stdout: "" });
    expect(await runHook("")).toMatchObject({ code: 0, stdout: "" });
  });

  it("Node older than 24 fails open with a logged reason", async () => {
    const { root } = tempRepo(true);
    expect(await runHook(pre(root), { CATENET_NODE_MAJOR_OVERRIDE: "20" })).toMatchObject({
      code: 0,
      stdout: "",
    });
    expect(readFileSync(join(root, ".catenet/hook-errors.log"), "utf8")).toContain("needs Node 24+");
  });

  it("happy path: a running daemon's context reaches the agent", async () => {
    const { root, run } = tempRepo(true);
    const daemon = createDaemon({ root, socket: join(run, "d.sock"), log: () => {} });
    cleanups.push(() => daemon.stop());
    await daemon.start();
    await daemon.index();
    const r = await runHook(pre(root));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain(
      "8 files depend on it directly",
    );
  });

  it("SessionStart starts the daemon when it isn't running", async () => {
    const { root, run } = tempRepo(true);
    await indexRepo({ root, full: true });
    const env = { CATENET_RUNTIME_DIR: run };
    cleanups.push(async () => {
      const saved = process.env.CATENET_RUNTIME_DIR;
      process.env.CATENET_RUNTIME_DIR = run;
      await stopDaemon(root);
      process.env.CATENET_RUNTIME_DIR = saved;
    });
    const r = await runHook(
      { session_id: "s1", cwd: root, hook_event_name: "SessionStart", source: "startup" },
      env,
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("ts-basic-lib");
    expect(existsSync(join(root, ".catenet/daemon.json"))).toBe(true);
  });
});
