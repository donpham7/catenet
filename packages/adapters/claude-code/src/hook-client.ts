// The command Claude Code runs for every Catenet hook (ADR-0015). It must be tiny, fast and harmless: only node:
// built-ins, no workspace imports, nothing printed except a valid hook response, and exit code 0 on every path.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SYNC_EVENTS = new Set(["SessionStart", "PreToolUse", "Stop", "SessionEnd"]);
const PRE_TOOL_TIMEOUT_MS = 250;
const OTHER_TIMEOUT_MS = 2000;
const SESSION_START_WAIT_MS = 1500;
/** hook-errors.log is rotated to hook-errors.log.1 past this size, so a persistent failure can't fill the disk. */
const MAX_ERROR_LOG_BYTES = 512 * 1024;
/** Payload fields Catenet never uses and that can be large (file contents, command output, the model's reply). */
const DROPPED_FIELDS = ["tool_response", "last_assistant_message"];

export interface ClientIo {
  stdin: string;
  env: NodeJS.ProcessEnv;
  write(text: string): void;
  /** Epoch ms when this process started (performance.timeOrigin), for end-to-end latency. */
  startedAt: number;
  /** Where to look for the repository instead of the payload's cwd (`catenet hook --repo`). */
  startDir?: string;
}

/**
 * Walk up from `dir` to the first directory with `.catenet/config.json` (only `catenet init` writes it: the opt-in).
 * The home directory and the filesystem root are never accepted or passed, so a stray `.catenet` there can't capture
 * every project below it. Same rule as findOptedInRoot in @catenet/core (this file can't import it).
 */
export function findRepoRoot(dir: string, home = homedir()): string | null {
  let current = resolve(dir);
  const stop = resolve(home);
  for (;;) {
    const parent = dirname(current);
    if (current === stop || parent === current) return null;
    try {
      if (statSync(join(current, ".catenet", "config.json")).isFile()) return current;
    } catch {
      // Not here; keep walking.
    }
    current = parent;
  }
}

/**
 * One tab-separated line per failure: time, hook event, session id, message. `catenet report` counts a session's
 * failures from it (HOOK_ERRORS_LOG in @catenet/core).
 */
function logError(root: string | null, event: string, sessionId: string, message: string): void {
  if (!root) return;
  const log = join(root, ".catenet", "hook-errors.log");
  const field = (s: string) => s.replace(/[\t\r\n]+/g, " ").slice(0, 300);
  try {
    if (existsSync(log) && statSync(log).size > MAX_ERROR_LOG_BYTES) renameSync(log, `${log}.1`);
    appendFileSync(
      log,
      `${new Date().toISOString()}\t${field(event)}\t${field(sessionId)}\t${field(message)}\n`,
    );
  } catch {
    // Nothing more we can do without affecting the agent.
  }
}

/** A connection that found no daemon at all (as opposed to a slow or broken one). */
const noDaemon = (err: unknown) => {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "NO_STATE";
};

function readSocket(root: string): string | null {
  try {
    const state = JSON.parse(readFileSync(join(root, ".catenet", "daemon.json"), "utf8")) as {
      socket?: unknown;
    };
    return typeof state.socket === "string" ? state.socket : null;
  } catch {
    return null;
  }
}

function post(socket: string, body: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolvePost, reject) => {
    const req = request(
      {
        socketPath: socket,
        method: "POST",
        path: "/hook",
        agent: false,
        timeout: timeoutMs,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          data += c;
        });
        res.on("end", () => resolvePost({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end(body);
  });
}

/** The daemon binary to start at SessionStart: next to this file in the plugin bundle, else the dev build. */
function daemonMain(env: NodeJS.ProcessEnv): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    env.CATENET_DAEMON_MAIN,
    join(here, "daemon.mjs"),
    resolve(here, "../../../daemon/dist/main.js"),
  ];
  return candidates.find((c): c is string => typeof c === "string" && existsSync(c)) ?? null;
}

async function startDaemon(root: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const main = daemonMain(env);
  if (!main) return null;
  const log = join(root, ".catenet", "daemon.log");
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, "a");
  spawn(process.execPath, [main, "--root", root], { detached: true, stdio: ["ignore", fd, fd], env }).unref();
  closeSync(fd);
  const deadline = Date.now() + SESSION_START_WAIT_MS;
  while (Date.now() < deadline) {
    const socket = readSocket(root);
    if (socket) {
      const ok = await post(socket, "{}", 200).then(
        () => true,
        () => false,
      );
      if (ok) return socket;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/** Run one hook invocation. Resolves when done; never rejects. */
export async function runHook(agent: string, io: ClientIo): Promise<void> {
  let root: string | null = null;
  let event = "unknown";
  let sessionId = "";
  try {
    const payload = JSON.parse(io.stdin) as Record<string, unknown>;
    if (!payload || typeof payload !== "object") return;
    event = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "unknown";
    sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
    // Dev-only: capture raw payloads to build contract-test fixtures (docs/HOOK_SCHEMAS.md). Never set in normal use.
    if (io.env.CATENET_HOOK_RECORD) {
      try {
        appendFileSync(io.env.CATENET_HOOK_RECORD, `${io.stdin.trim()}\n`);
      } catch {
        // Recording is best effort.
      }
    }
    const start =
      io.startDir ??
      (typeof payload.cwd === "string" ? payload.cwd : (io.env.CLAUDE_PROJECT_DIR ?? process.cwd()));
    root = findRepoRoot(start);
    if (!root) return; // not opted in: do nothing at all
    const major = Number(io.env.CATENET_NODE_MAJOR_OVERRIDE ?? process.versions.node.split(".")[0]);
    if (major < 24)
      return logError(
        root,
        event,
        sessionId,
        `Node ${process.versions.node} is too old; Catenet needs Node 24+ (the plugin runs \`node\` from PATH)`,
      );

    let socket = readSocket(root);
    const sent = { ...payload };
    for (const f of DROPPED_FIELDS) delete sent[f];
    const body = JSON.stringify({ agent, payload: sent, clientStartedAt: io.startedAt });
    const timeout = event === "PreToolUse" ? PRE_TOOL_TIMEOUT_MS : OTHER_TIMEOUT_MS;
    let res: { status: number; body: string };
    try {
      if (!socket) throw Object.assign(new Error("no daemon.json"), { code: "NO_STATE" });
      res = await post(socket, body, timeout);
    } catch (err) {
      // Only SessionStart may start a daemon, and only when none is running: a slow daemon is still the repo's
      // daemon, and starting another would leave two. Every other hook just records the miss.
      if (event !== "SessionStart" || !noDaemon(err)) throw err;
      socket = await startDaemon(root, io.env);
      if (!socket)
        throw new Error(`daemon unavailable (${err instanceof Error ? err.message : String(err)})`);
      res = await post(socket, body, timeout);
    }
    // A daemon from an older build answers 404 here; the MCP server's start-up replaces it.
    if (res.status !== 200) throw new Error(`daemon answered HTTP ${res.status} (an older daemon build?)`);
    const parsed = JSON.parse(res.body) as { output?: unknown };
    // Only a response for a synchronous hook is meaningful; anything that isn't a JSON object is dropped.
    if (SYNC_EVENTS.has(event) && typeof parsed.output === "string" && parsed.output.startsWith("{"))
      io.write(parsed.output);
  } catch (err) {
    logError(root, event, sessionId, err instanceof Error ? err.message : String(err));
  }
}
