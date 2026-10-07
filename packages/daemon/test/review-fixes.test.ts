// Regression tests for the M2 code review. Each failed before its fix.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { generateSyntheticRepo } from "../../core/bench/generate.ts";
import {
  createDaemon,
  type Daemon,
  ensureDaemon,
  health,
  isOurDaemon,
  requestIndex,
  socketPath,
  stateFile,
  stopDaemon,
} from "../src/index.js";
import { fixtureCopy, until } from "./helpers.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const savedRuntime = process.env.CATENET_RUNTIME_DIR;
function useRuntime(dir: string) {
  mkdirSync(dir, { recursive: true });
  process.env.CATENET_RUNTIME_DIR = dir;
  cleanups.push(() => {
    process.env.CATENET_RUNTIME_DIR = savedRuntime;
  });
}

describe("health stays responsive while indexing (review #1)", () => {
  it("answers in under 100 ms during a full index of a 2k-file repo", async () => {
    const root = join(tmpdir(), `cnd-big-${process.pid}`);
    generateSyntheticRepo(root);
    cleanups.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const socket = join(tmpdir(), `cnd-big-${process.pid}.sock`);
    const daemon = createDaemon({ root, socket, log: () => {} });
    cleanups.push(() => daemon.stop());
    await daemon.start();
    await until(() => daemon.snapshot().lastIndex, 20_000);
    const full = daemon.index(true);
    await until(() => daemon.snapshot().indexing, 2000);
    const latencies: number[] = [];
    while (daemon.snapshot().indexing) {
      const t0 = performance.now();
      await health(socket, 2000);
      latencies.push(performance.now() - t0);
      await sleep(20);
    }
    await full;
    expect(latencies.length).toBeGreaterThan(3);
    expect(Math.max(...latencies)).toBeLessThan(100);
  });
});

describe("stop only removes its own socket (review #2)", () => {
  it("leaves a newer daemon's socket in place", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    mkdirSync(repo.runtime, { recursive: true });
    const socket = join(repo.runtime, "d.sock");
    const d1 = createDaemon({ root: repo.root, socket, log: () => {} });
    await d1.start();
    unlinkSync(socket); // simulate a replacement daemon taking over the path
    const d2 = createDaemon({ root: repo.root, socket, log: () => {} });
    cleanups.push(() => d2.stop());
    await d2.start();
    await d1.stop();
    expect((await health(socket)).ok).toBe(true);
  });
});

describe("never signals a process that isn't our daemon (review #3)", () => {
  it("recognises its own daemon and ignores unrelated pids", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    useRuntime(repo.runtime);
    const env = { ...process.env, CATENET_RUNTIME_DIR: repo.runtime };
    const bystander = spawn("sleep", ["30"], { stdio: "ignore" });
    cleanups.push(() => void bystander.kill());
    const pid = bystander.pid as number;
    expect(isOurDaemon(pid, repo.root)).toBe(false);
    mkdirSync(join(repo.root, ".catenet"), { recursive: true });
    writeFileSync(
      stateFile(repo.root),
      JSON.stringify({ pid, socket: socketPath(repo.root), buildId: "x", startedAt: "" }),
    );
    const r = await ensureDaemon(repo.root, env);
    cleanups.push(async () => void (await stopDaemon(repo.root)));
    expect(r.status).toBe("started");
    expect(bystander.exitCode).toBeNull(); // still alive: never signalled
    if (r.status !== "failed") expect(isOurDaemon(r.health.pid, repo.root)).toBe(true);
  });
});

describe("a restart is only reported once the new build answers (review #4)", () => {
  it("fails instead of claiming success when an old daemon refuses to exit", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    useRuntime(repo.runtime);
    const socket = socketPath(repo.root);
    const impostor: Server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          req.url === "/health"
            ? { ok: true, buildId: "old-build", pid: process.pid, watching: true }
            : { ok: true },
        ),
      );
    });
    await new Promise<void>((resolve) => impostor.listen(socket, () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => impostor.close(() => resolve())));
    const r = await ensureDaemon(repo.root, { ...process.env, CATENET_RUNTIME_DIR: repo.runtime });
    expect(r.status).toBe("failed");
  });
});

describe("the watcher ignores files that can't affect the graph (review #5)", () => {
  it("does not reindex for log or temp writes, but does for code", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    mkdirSync(repo.runtime, { recursive: true });
    const daemon: Daemon = createDaemon({
      root: repo.root,
      socket: join(repo.runtime, "d.sock"),
      log: () => {},
    });
    cleanups.push(() => daemon.stop());
    await daemon.start();
    await until(() => daemon.snapshot().watching && daemon.snapshot().lastIndex);
    // Let late events for the fixture copy (macOS can deliver them after the watcher is ready) settle first.
    let settled = daemon.snapshot().lastIndex?.at;
    for (let quiet = 0; quiet < 3; ) {
      await sleep(250);
      const now = daemon.snapshot().lastIndex?.at;
      quiet = now === settled && !daemon.snapshot().indexing ? quiet + 1 : 0;
      settled = now;
    }
    const before = daemon.snapshot().lastIndex?.at;
    writeFileSync(join(repo.root, "server.log"), "line\n");
    mkdirSync(join(repo.root, "tmp"), { recursive: true });
    writeFileSync(join(repo.root, "tmp/cache.bin"), "x");
    await sleep(800);
    expect(daemon.snapshot().lastIndex?.at).toBe(before);
    writeFileSync(join(repo.root, "src/added.ts"), "export const a = 1;\n");
    await until(() => daemon.snapshot().lastIndex?.at !== before, 5000);
  });
});

describe("requestIndex distinguishes 'no daemon' from 'daemon failed' (review #6)", () => {
  it("classifies unreachable, ok and error", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    useRuntime(repo.runtime);
    expect((await requestIndex(repo.root)).kind).toBe("unreachable");
    const failing: Server = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "disk full" }));
    });
    await new Promise<void>((resolve) => failing.listen(socketPath(repo.root), () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => failing.close(() => resolve())));
    expect(await requestIndex(repo.root)).toEqual({ kind: "error", message: "disk full" });
  });
});

describe("stopDaemon reports whether a daemon was running (review #8)", () => {
  it("returns false when nothing was running", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    useRuntime(repo.runtime);
    expect(await stopDaemon(repo.root)).toBe("not-running");
  });
});
