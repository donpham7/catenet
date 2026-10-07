// Start, find, stop and inspect a repo's daemon. Callers (MCP server, CLI) never get an exception from ensureDaemon:
// a daemon that won't start only means the graph may go stale.
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { call, type HealthResponse, health } from "./client.js";
import {
  buildId,
  DAEMON_MAIN,
  type DaemonState,
  isOurDaemon,
  logFile,
  socketPath,
  stateFile,
} from "./paths.js";

/** The build id a daemon spawned with `env` would report (tests vary CATENET_BUILD_SALT through env). */
function buildIdFor(env: NodeJS.ProcessEnv): string {
  const saved = process.env.CATENET_BUILD_SALT;
  if (env.CATENET_BUILD_SALT === undefined) delete process.env.CATENET_BUILD_SALT;
  else process.env.CATENET_BUILD_SALT = env.CATENET_BUILD_SALT;
  try {
    return buildId();
  } finally {
    if (saved === undefined) delete process.env.CATENET_BUILD_SALT;
    else process.env.CATENET_BUILD_SALT = saved;
  }
}

export type EnsureResult =
  | { status: "running" | "started" | "restarted"; health: HealthResponse }
  | { status: "failed"; error: string };

const LOG_LIMIT = 5 * 1024 * 1024;

export function readState(root: string): DaemonState | null {
  try {
    return JSON.parse(readFileSync(stateFile(root), "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await sleep(50);
  }
  return null;
}

const tryHealth = (socket: string) => health(socket, 500).catch(() => null);

export async function daemonStatus(
  root: string,
): Promise<{ running: boolean; health: HealthResponse | null; state: DaemonState | null }> {
  const h = await tryHealth(socketPath(root));
  return { running: h !== null, health: h, state: readState(root) };
}

/** Make sure a current daemon serves `root`: reuse, restart if its build differs, or spawn one. Never throws. */
export async function ensureDaemon(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EnsureResult> {
  try {
    const socket = socketPath(root);
    const want = buildIdFor(env);
    let restarted = false;
    const existing = await tryHealth(socket);
    if (existing && existing.buildId === want) return { status: "running", health: existing };
    if (existing) {
      await stopDaemon(root);
      const still = await tryHealth(socket);
      if (still)
        return {
          status: "failed",
          error: `an older daemon (build ${still.buildId}, pid ${still.pid}) did not exit`,
        };
      restarted = true;
    } else {
      // No answer. Indexing runs in a worker, so a live daemon always answers health; silence means it crashed, hung,
      // or the recorded pid now belongs to something else. Only our own daemon is ever signalled (M2 review #3).
      const state = readState(root);
      if (state && isAlive(state.pid) && isOurDaemon(state.pid, root)) {
        const late = await waitFor(() => tryHealth(socket), 2000);
        if (late && late.buildId === want) return { status: "running", health: late };
        try {
          process.kill(state.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      if (process.platform !== "win32" && !(await tryHealth(socket))) rmSync(socket, { force: true });
      rmSync(stateFile(root), { force: true });
    }
    if (!existsSync(DAEMON_MAIN))
      return { status: "failed", error: `daemon binary missing (${DAEMON_MAIN}); run pnpm build` };
    const log = logFile(root);
    mkdirSync(dirname(log), { recursive: true });
    if (existsSync(log) && statSync(log).size > LOG_LIMIT) truncateSync(log, 0);
    const fd = openSync(log, "a");
    const child = spawn(process.execPath, [DAEMON_MAIN, "--root", root], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env,
    });
    child.unref();
    closeSync(fd);
    // Only a daemon of the wanted build counts; an old one still holding the socket is a failure (M2 review #4).
    const ready = await waitFor(async () => {
      const h = await tryHealth(socket);
      return h && h.buildId === want ? h : null;
    }, 5000); // cold Node start on a busy or slow machine can take a few seconds
    if (!ready) return { status: "failed", error: `daemon did not start; see ${log}` };
    return { status: restarted ? "restarted" : "started", health: ready };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export type StopResult = "stopped" | "not-running" | "still-running";

/** Ask the daemon to exit; fall back to SIGTERM, but only for a verified Catenet daemon process. */
export async function stopDaemon(root: string): Promise<StopResult> {
  const socket = socketPath(root);
  const state = readState(root);
  const asked = await call(socket, "POST", "/shutdown").then(
    () => true,
    () => false,
  );
  const ours = !asked && state !== null && isAlive(state.pid) && isOurDaemon(state.pid, root);
  if (!asked && !ours) return "not-running";
  if (ours && state) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  const gone = await waitFor(async () => ((await tryHealth(socket)) === null ? true : null), 3000);
  return gone ? "stopped" : "still-running";
}

export type IndexRequest =
  | { kind: "ok"; stats: Record<string, unknown> }
  | { kind: "unreachable" }
  | { kind: "error"; message: string };

const UNREACHABLE = new Set(["ENOENT", "ECONNREFUSED", "ENOTSOCK", "EPIPE"]);

/**
 * Ask the running daemon to index now. "unreachable" (no daemon listening) is different from "error" (the daemon's
 * own index failed or timed out): callers fall back to indexing in-process only for the former (M2 review #6).
 */
export async function requestIndex(root: string, full = false, timeoutMs = 120_000): Promise<IndexRequest> {
  try {
    const stats = await call<Record<string, unknown>>(
      socketPath(root),
      "POST",
      "/index",
      { full },
      timeoutMs,
    );
    return { kind: "ok", stats };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && UNREACHABLE.has(code)) return { kind: "unreachable" };
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
