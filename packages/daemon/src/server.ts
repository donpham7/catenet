// The daemon: the only long-lived writer of graph.db (ADR-0014). Serves health and index requests over a user-private
// unix socket, keeps the graph current with a file watcher, and exits when idle.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import { CATENET_VERSION, type IndexStats } from "@catenet/core";
import { type HealthResponse, health } from "./client.js";
import { HookHandler, type HookRequest } from "./hooks.js";
import { buildId as currentBuildId, type DaemonState, INDEX_WORKER, socketPath, stateFile } from "./paths.js";
import { type RepoWatcher, watchRepo } from "./watcher.js";

export class AlreadyRunningError extends Error {}

export interface DaemonOptions {
  root: string;
  /** Exit after this long without requests (default 60 min). */
  idleMs?: number;
  /** Override the database location (tests). */
  dbPath?: string;
  /** Override the socket path (tests). */
  socket?: string;
  log?: (line: string) => void;
  /** Called after the daemon has fully stopped (idle exit, /shutdown or stop()). */
  onStop?: () => void;
}

export interface Daemon {
  readonly socket: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Queue an index run; resolves with the stats of a run that started after this call. */
  index(full?: boolean): Promise<IndexStats>;
  snapshot(): HealthResponse;
}

export const DEFAULT_IDLE_MS = 60 * 60 * 1000;
/** Request bodies above this are dropped unread (hook clients strip tool output, so real payloads are small). */
export const MAX_BODY_BYTES = 1024 * 1024;
/** After the hook handler fails to start (e.g. events.db unwritable), wait this long before trying again. */
const HOOKS_RETRY_MS = 30_000;

export function createDaemon(opts: DaemonOptions): Daemon {
  const root = opts.root;
  const socket = opts.socket ?? socketPath(root);
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const log = opts.log ?? ((line: string) => process.stderr.write(`${new Date().toISOString()} ${line}\n`));
  const build = currentBuildId();
  const startedAt = new Date().toISOString();
  let lastRequestAt = Date.now();
  let lastIndex: HealthResponse["lastIndex"] = null;
  let watcher: RepoWatcher | null = null;
  let watching = false;
  let server: Server | null = null;
  let idleTimer: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | null = null;
  // Index runs are serialised. Requests that arrive during a run are batched into exactly one follow-up run.
  let running = false;
  let pending = false;
  let pendingFull = false;
  let waiters: { resolve: (s: IndexStats) => void; reject: (e: unknown) => void }[] = [];

  // Indexing runs in a worker thread (M2 review #1): the HTTP server never stops answering. The worker is reused across
  // runs (grammars load once) and recreated if it dies.
  let worker: Worker | null = null;
  let nextJob = 0;
  const jobs = new Map<number, { resolve: (s: IndexStats) => void; reject: (e: Error) => void }>();
  const runInWorker = (full: boolean): Promise<IndexStats> => {
    if (!worker) {
      // execArgv: [] so the worker never inherits the parent's module flags (e.g. a test runner's export conditions).
      const w = new Worker(INDEX_WORKER, { execArgv: [] });
      w.on("message", (msg: { id: number; stats?: IndexStats; error?: string }) => {
        const job = jobs.get(msg.id);
        jobs.delete(msg.id);
        if (msg.stats) job?.resolve(msg.stats);
        else job?.reject(new Error(msg.error ?? "index failed"));
      });
      w.on("error", (err) => {
        for (const job of jobs.values()) job.reject(err);
        jobs.clear();
        worker = null;
      });
      w.on("exit", () => {
        if (worker === w) worker = null;
      });
      worker = w;
    }
    const id = ++nextJob;
    const active = worker;
    return new Promise((resolve, reject) => {
      jobs.set(id, { resolve, reject });
      active.postMessage({ id, root, dbPath: opts.dbPath, full });
    });
  };

  const drain = async () => {
    running = true;
    while (pending) {
      pending = false;
      const full = pendingFull;
      pendingFull = false;
      const batch = waiters;
      waiters = [];
      try {
        const stats = await runInWorker(full);
        lastIndex = {
          at: new Date().toISOString(),
          mode: stats.mode,
          ms: Math.round(stats.ms),
          files: stats.files,
          error: null,
        };
        if (stats.mode !== "noop")
          log(`indexed ${stats.files} files (${stats.mode}, ${Math.round(stats.ms)} ms)`);
        for (const w of batch) w.resolve(stats);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastIndex = {
          at: new Date().toISOString(),
          mode: "error",
          ms: 0,
          files: lastIndex?.files ?? 0,
          error: message,
        };
        log(`index failed: ${message}`);
        for (const w of batch) w.reject(err);
      }
    }
    running = false;
  };

  const index = (full = false): Promise<IndexStats> =>
    new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
      pending = true;
      pendingFull ||= full;
      if (!running) void drain();
    });

  /** Created on the first hook, so a daemon serving only MCP never opens events.db. */
  let hooks: HookHandler | null = null;
  let hooksFailedAt = 0;
  /** The hook handler, created on first use. Never throws: a broken events.db must not take the daemon down. */
  const hookHandler = (): HookHandler | null => {
    if (hooks || Date.now() - hooksFailedAt < HOOKS_RETRY_MS) return hooks;
    try {
      hooks = new HookHandler(root, opts.dbPath, log);
    } catch (err) {
      hooksFailedAt = Date.now();
      log(`hook recording unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    return hooks;
  };

  const snapshot = (): HealthResponse => ({
    ok: true,
    version: CATENET_VERSION,
    buildId: build,
    pid: process.pid,
    root,
    startedAt,
    watching,
    indexing: running,
    lastIndex,
  });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
    res.end(text);
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    lastRequestAt = Date.now();
    let body = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      if (tooLarge) return;
      if (Buffer.byteLength(body) + Buffer.byteLength(c) > MAX_BODY_BYTES) {
        tooLarge = true;
        body = "";
      } else body += c;
    });
    req.on("end", () => {
      if (tooLarge) {
        log(`dropped a ${req.method} ${req.url} request larger than ${MAX_BODY_BYTES} bytes`);
        return json(
          res,
          req.url === "/hook" ? 200 : 413,
          req.url === "/hook" ? { output: "" } : { error: "too large" },
        );
      }
      if (req.method === "GET" && req.url === "/health") return json(res, 200, snapshot());
      if (req.method === "POST" && req.url === "/index") {
        let full = false;
        try {
          full = body ? (JSON.parse(body) as { full?: boolean }).full === true : false;
        } catch {
          return json(res, 400, { error: "invalid JSON body" });
        }
        index(full).then(
          (stats) => json(res, 200, stats),
          (err: unknown) => json(res, 500, { error: err instanceof Error ? err.message : String(err) }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/hook") {
        // Agent hooks (ADR-0015). Always 200: a hook failure must never reach the agent.
        let parsed: HookRequest = {};
        try {
          parsed = body ? (JSON.parse(body) as HookRequest) : {};
        } catch {
          return json(res, 200, { output: "" });
        }
        return json(res, 200, hookHandler()?.handle(parsed) ?? { output: "" });
      }
      if (req.method === "POST" && req.url === "/shutdown") {
        json(res, 200, { ok: true });
        void stop();
        return;
      }
      json(res, 404, { error: "not found" });
    });
  };

  const writeState = () => {
    const state: DaemonState = { pid: process.pid, socket, buildId: build, startedAt };
    mkdirSync(dirname(stateFile(root)), { recursive: true });
    writeFileSync(stateFile(root), `${JSON.stringify(state, null, 2)}\n`);
  };

  const removeState = () => {
    try {
      const state = JSON.parse(readFileSync(stateFile(root), "utf8")) as DaemonState;
      if (state.pid === process.pid) rmSync(stateFile(root), { force: true });
    } catch {
      // Missing or unreadable: nothing of ours to remove.
    }
  };

  const start = async () => {
    if (process.platform !== "win32" && existsSync(socket)) {
      // A live daemon answers; a dead one left a stale socket file behind.
      const alive = await health(socket, 500).then(
        () => true,
        () => false,
      );
      if (alive) throw new AlreadyRunningError(`a daemon is already serving ${socket}`);
      rmSync(socket, { force: true });
    }
    server = createServer(handle);
    // Bind a private path, then rename it onto the shared one. Node deletes a unix socket *by path* when its server
    // closes, so binding the shared path directly would let an exiting old daemon delete a newer daemon's socket
    // (M2 review #2). Closing only ever removes this daemon's private name, which no longer exists after the rename.
    const bindPath =
      process.platform === "win32" ? socket : `${socket}.${process.pid}-${randomBytes(4).toString("hex")}`;
    if (bindPath !== socket) rmSync(bindPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      server?.once("error", (err: NodeJS.ErrnoException) =>
        reject(
          err.code === "EADDRINUSE" ? new AlreadyRunningError(`a daemon is already serving ${socket}`) : err,
        ),
      );
      server?.listen(bindPath, () => resolve());
    });
    if (bindPath !== socket) {
      renameSync(bindPath, socket);
      // Two daemons racing to start: the one whose socket ended up at the shared path wins; the other exits.
      const owner = await health(socket, 1000).catch(() => null);
      if (owner?.pid !== process.pid) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        throw new AlreadyRunningError(`another daemon took over ${socket}`);
      }
    }
    writeState();
    log(`daemon ${build} pid ${process.pid} serving ${root} on ${socket}`);
    watcher = watchRepo(root, () => {
      void index().catch(() => {});
    });
    void watcher.ready.then(() => {
      watching = true;
    });
    void index().catch(() => {});
    idleTimer = setInterval(
      () => {
        if (Date.now() - lastRequestAt >= idleMs) {
          log(`idle for ${Math.round(idleMs / 1000)} s, exiting`);
          void stop();
        }
      },
      Math.max(50, Math.min(60_000, Math.floor(idleMs / 4))),
    );
  };

  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      clearInterval(idleTimer);
      watching = false;
      await watcher?.close();
      await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
      // Our server is closed now, so anything still answering on this path is a newer daemon: leave its socket alone
      // (M2 review #2). Inode numbers can't decide this; the OS reuses them.
      if (process.platform !== "win32" && existsSync(socket)) {
        const other = await health(socket, 300).catch(() => null);
        if (!other) rmSync(socket, { force: true });
      }
      await worker?.terminate();
      hooks?.close();
      removeState();
      log("daemon stopped");
      opts.onStop?.();
    })();
    return stopping;
  };

  return { socket, start, stop, index, snapshot };
}
