// POST /hook (ADR-0015): translate an agent's hook payload to a neutral event, record it, track edit diffs, and build
// context to inject. It never throws to the client and never blocks: any failure means an empty response.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isSyncEvent, respond, translate } from "@catenet/adapter-claude-code";
import {
  defaultDbPath,
  EDIT_TOOLS,
  EventStore,
  editContext,
  editTarget,
  type Graph,
  lineDiff,
  loadConfig,
  type NeutralEvent,
  openGraph,
  sessionContext,
} from "@catenet/core";

interface Adapter {
  translate(payload: unknown, ts?: number): NeutralEvent | null;
  respond(event: string, context: string | null): string;
  isSyncEvent(event: string): boolean;
}

const ADAPTERS: Record<string, Adapter> = { "claude-code": { translate, respond, isSyncEvent } };
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const BEFORE_TTL_MS = 10 * 60 * 1000;

export interface HookRequest {
  agent?: unknown;
  payload?: unknown;
  clientStartedAt?: unknown;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 20);

/**
 * A file's state for diff stats. `text` is null when the file doesn't exist (a create or delete, which is a real
 * diff). `skipped` means it exists but wasn't read: not a regular file (a FIFO or device would block or never end),
 * larger than 2 MB, outside the repository after resolving symlinks, or unreadable.
 */
interface FileState {
  text: string | null;
  skipped: boolean;
}

function readState(path: string, root: string): FileState {
  try {
    if (!existsSync(path)) return { text: null, skipped: false };
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_DIFF_BYTES) return { text: null, skipped: true };
    const real = realpathSync(path);
    const rel = relative(realpathSync(root), real);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return { text: null, skipped: true };
    return { text: readFileSync(real, "utf8"), skipped: false };
  } catch {
    return { text: null, skipped: true };
  }
}

export class HookHandler {
  readonly events: EventStore;
  private graph: Graph | null = null;
  /** Before-state of in-flight edits, kept in memory only (content is never stored). */
  private readonly before = new Map<string, FileState & { at: number }>();
  /** Files already explained in a session, so each file is mentioned at most once per session. */
  private readonly explained = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly dbPath = defaultDbPath(root),
    private readonly log: (line: string) => void = () => {},
  ) {
    this.events = new EventStore(join(root, ".catenet", "events.db"), { root });
    // Pruning runs after the first hook's answer, not inside it.
    setImmediate(() => {
      try {
        this.events.prune(loadConfig(root).retentionDays);
      } catch (err) {
        this.log(`event pruning failed: ${String(err)}`);
      }
    });
  }

  close(): void {
    this.graph?.close();
    this.events.close();
  }

  private getGraph(): Graph | null {
    if (this.graph) return this.graph;
    if (!existsSync(this.dbPath)) return null;
    this.graph = openGraph(this.dbPath);
    return this.graph;
  }

  private rel(path: string, cwd: string): string | null {
    const abs = isAbsolute(path) ? path : resolve(cwd, path);
    const r = relative(this.root, abs);
    return r && !r.startsWith("..") && !isAbsolute(r) ? r.split("\\").join("/") : null;
  }

  /** Never throws: a hook must not be able to affect the agent through an error here. */
  handle(body: HookRequest): { output: string } {
    try {
      return this.handleUnsafe(body);
    } catch (err) {
      this.log(`hook failed: ${err instanceof Error ? err.message : String(err)}`);
      try {
        this.events.recordError("hook", err instanceof Error ? err.message : String(err));
      } catch {
        // Even the error log is best effort.
      }
      return { output: "" };
    }
  }

  private handleUnsafe(body: HookRequest): { output: string } {
    if (!body || typeof body !== "object") return { output: "" };
    const adapter = typeof body.agent === "string" ? ADAPTERS[body.agent] : undefined;
    if (!adapter) return { output: "" };
    const now = Date.now();
    const event = adapter.translate(body.payload, now);
    if (!event) return { output: "" };
    const hookEvent = String((body.payload as { hook_event_name?: unknown }).hook_event_name);
    const cwd = event.cwd ?? this.root;
    const config = loadConfig(this.root);

    if (event.type === "session_start") {
      try {
        event.gitHead = execFileSync("git", ["-C", this.root, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1000,
        }).trim();
      } catch {
        // Not a git repo, or git unavailable.
      }
    }
    this.events.record(event);

    let context: string | null = null;
    if (event.type === "session_start" && config.inject.sessionStart) {
      const g = this.getGraph();
      context = g ? sessionContext(g) : null;
    }
    if ((event.type === "tool_call_start" || event.type === "tool_call_end") && EDIT_TOOLS.has(event.tool)) {
      const target = editTarget(event.input);
      const rel = target ? this.rel(target, cwd) : null;
      const key = `${event.agent}|${event.sessionId}|${event.toolUseId}`;
      // Files outside the repository are recorded as tool calls but never read, hashed or diffed.
      const abs = target ? (isAbsolute(target) ? target : resolve(cwd, target)) : null;
      if (event.type === "tool_call_start" && abs && rel) {
        this.before.set(key, { ...readState(abs, this.root), at: now });
        if (rel && config.inject.beforeEdit) {
          const seen = `${event.agent}|${event.sessionId}|${rel}`;
          const g = this.getGraph();
          if (!this.explained.has(seen) && g) {
            context = editContext(g, rel);
            if (context) this.explained.add(seen);
          }
        }
      }
      if (event.type === "tool_call_end" && abs && rel) {
        const prior = this.before.get(key);
        this.before.delete(key);
        // A failed or denied edit changed nothing, so it gets no diff row.
        if (event.outcome === "succeeded") {
          const after = readState(abs, this.root);
          // Partial: the before-state is missing (daemon restarted, or the call took over 10 minutes) or a read
          // was skipped, so the counts can't be trusted.
          const partial = prior === undefined || prior.skipped || after.skipped;
          const { added, removed } = partial ? { added: 0, removed: 0 } : lineDiff(prior.text, after.text);
          this.events.recordDiff({
            agent: event.agent,
            sessionId: event.sessionId,
            ts: now,
            toolUseId: event.toolUseId,
            path: rel,
            added,
            removed,
            hashBefore: prior?.text != null ? sha(prior.text) : null,
            hashAfter: after.text != null ? sha(after.text) : null,
            partial,
          });
        }
      }
    }
    for (const [k, v] of this.before) if (now - v.at > BEFORE_TTL_MS) this.before.delete(k);

    const output = adapter.respond(hookEvent, context);
    const started = typeof body.clientStartedAt === "number" ? body.clientStartedAt : now;
    this.events.recordHookCall({
      agent: event.agent,
      sessionId: event.sessionId,
      ts: now,
      event: hookEvent,
      sync: adapter.isSyncEvent(hookEvent),
      ms: Date.now() - started,
    });
    return { output };
  }
}
