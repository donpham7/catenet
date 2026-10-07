// Real processes: spawn, reuse, stop, crash recovery and build-mismatch restart (ROADMAP M2: "daemon restarts cleanly").
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptsBuild,
  daemonStatus,
  ensureDaemon,
  readState,
  socketPath,
  stateFile,
  stopDaemon,
} from "../src/index.js";
import { fixtureCopy, until } from "./helpers.js";

let repo: ReturnType<typeof fixtureCopy>;
let env: NodeJS.ProcessEnv;
const savedRuntime = process.env.CATENET_RUNTIME_DIR;

beforeEach(() => {
  repo = fixtureCopy("ts-basic");
  process.env.CATENET_RUNTIME_DIR = repo.runtime; // same socket location for this process and the daemon
  env = { ...process.env, CATENET_RUNTIME_DIR: repo.runtime, CATENET_DAEMON_IDLE_MS: "120000" };
});
afterEach(async () => {
  await stopDaemon(repo.root);
  process.env.CATENET_RUNTIME_DIR = savedRuntime;
  delete process.env.CATENET_BUILD_SALT;
  repo.cleanup();
});

describe("daemon lifecycle", () => {
  it("starts once and is reused", async () => {
    const first = await ensureDaemon(repo.root, env);
    expect(first.status).toBe("started");
    const second = await ensureDaemon(repo.root, env);
    expect(second.status).toBe("running");
    if (first.status !== "failed" && second.status !== "failed")
      expect(second.health.pid).toBe(first.health.pid);
    expect(readState(repo.root)?.socket).toBe(socketPath(repo.root));
  });

  it("stop removes the socket and the state file", async () => {
    await ensureDaemon(repo.root, env);
    expect(await stopDaemon(repo.root)).toBe("stopped");
    await until(() => !existsSync(socketPath(repo.root)) && !existsSync(stateFile(repo.root)));
    expect((await daemonStatus(repo.root)).running).toBe(false);
  });

  it("recovers from a crashed daemon (kill -9 leaves a stale socket)", async () => {
    const first = await ensureDaemon(repo.root, env);
    if (first.status === "failed") throw new Error(first.error);
    process.kill(first.health.pid, "SIGKILL");
    await until(() => {
      try {
        process.kill(first.health.pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    expect(existsSync(socketPath(repo.root))).toBe(true); // stale socket left behind
    const second = await ensureDaemon(repo.root, env);
    expect(second.status).toBe("started");
    if (second.status !== "failed") expect(second.health.pid).not.toBe(first.health.pid);
  });

  it("replaces a daemon from a different build", async () => {
    const old = await ensureDaemon(repo.root, { ...env, CATENET_BUILD_SALT: "old" });
    if (old.status === "failed") throw new Error(old.error);
    const fresh = await ensureDaemon(repo.root, env);
    expect(fresh.status).toBe("restarted");
    if (fresh.status !== "failed") expect(fresh.health.pid).not.toBe(old.health.pid);
  });

  it("stops a stuck daemon that ignores SIGTERM (escalates to SIGKILL)", async () => {
    // A process that looks like our daemon for this repo (same command-line shape) and ignores SIGTERM, as a daemon
    // with a blocked event loop would.
    const fakeMain = join(repo.runtime, "daemon.mjs");
    mkdirSync(repo.runtime, { recursive: true });
    writeFileSync(fakeMain, 'process.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [fakeMain, "--root", repo.root], { stdio: "ignore" });
    const exited = new Promise<void>((r) => child.on("exit", () => r()));
    await until(() => child.pid);
    mkdirSync(join(repo.root, ".catenet"), { recursive: true });
    writeFileSync(stateFile(repo.root), JSON.stringify({ pid: child.pid, socket: socketPath(repo.root) }));
    await new Promise((r) => setTimeout(r, 200)); // let it install the SIGTERM handler
    expect(await stopDaemon(repo.root)).toBe("stopped");
    await exited;
    expect(child.signalCode).toBe("SIGKILL");
  });
});

describe("acceptsBuild", () => {
  it("reuses the same build or the other install of the same version, and replaces anything else", () => {
    expect(acceptsBuild("0.1.0+plugin+100", "0.1.0+plugin+100")).toBe(true);
    // The workspace CLI and the plugin bundle must not keep replacing each other's daemon.
    expect(acceptsBuild("0.1.0+plugin+100", "0.1.0+workspace+200")).toBe(true);
    expect(acceptsBuild("0.1.0+workspace+200", "0.1.0+plugin+100")).toBe(true);
    // A rebuild of the same install, or another version, replaces.
    expect(acceptsBuild("0.1.0+plugin+100", "0.1.0+plugin+101")).toBe(false);
    expect(acceptsBuild("0.1.0+workspace+100+old", "0.1.0+workspace+100")).toBe(false);
    expect(acceptsBuild("0.0.9+plugin+100", "0.1.0+workspace+100")).toBe(false);
  });
});
