// events.db (ARCHITECTURE 2.4): a neutral, private log of sessions, prompts, tool calls, diffs and hook latency. The
// daemon is its only writer. Text is redacted before it is stored; file contents are never stored.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { prepareStateDir } from "../config.js";
import { redactSecrets, summarizeToolInput } from "./redact.js";
import type { AgentName, NeutralEvent } from "./types.js";

export const EVENTS_SCHEMA_VERSION = 2;

/**
 * The hook client's failure log, next to events.db. The client can't write events.db (the daemon is its only writer),
 * so hooks that never reached the daemon are counted from here. One line per failure, tab-separated:
 * ISO time, hook event, session id, message. Keep in sync with packages/adapters/claude-code/src/hook-client.ts.
 */
export const HOOK_ERRORS_LOG = "hook-errors.log";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions (
  agent TEXT NOT NULL, id TEXT NOT NULL, model TEXT, source TEXT, cwd TEXT, git_head TEXT,
  started_at INTEGER NOT NULL, last_event_at INTEGER NOT NULL, ended_at INTEGER, end_reason TEXT, turns INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent, id)
);
CREATE TABLE prompts (
  id INTEGER PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, ts INTEGER NOT NULL,
  text_hash TEXT NOT NULL, text_preview_redacted TEXT NOT NULL
);
CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, tool_use_id TEXT NOT NULL, ts INTEGER NOT NULL,
  tool TEXT NOT NULL, target_paths TEXT NOT NULL, args_summary TEXT NOT NULL, outcome TEXT NOT NULL,
  duration_ms INTEGER, ended_at INTEGER,
  UNIQUE (agent, session_id, tool_use_id)
);
CREATE TABLE diffs (
  id INTEGER PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, tool_use_id TEXT NOT NULL, ts INTEGER NOT NULL,
  path TEXT NOT NULL, added INTEGER NOT NULL, removed INTEGER NOT NULL, hash_before TEXT, hash_after TEXT, partial INTEGER NOT NULL
);
CREATE TABLE compactions (
  id INTEGER PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, ts INTEGER NOT NULL, phase TEXT NOT NULL, trigger TEXT NOT NULL
);
-- ms: from the hook process starting to the daemon's answer. sync: the agent waited for this hook (the latency
-- budget applies only to these).
CREATE TABLE hook_calls (
  id INTEGER PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, ts INTEGER NOT NULL, event TEXT NOT NULL,
  sync INTEGER NOT NULL, ms INTEGER NOT NULL
);
-- Gate decisions arrive in M5; the table exists so the schema is stable.
CREATE TABLE decisions (
  id TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, tool_use_id TEXT, ts INTEGER NOT NULL,
  verdict TEXT NOT NULL, rule_ids TEXT NOT NULL, evidence TEXT NOT NULL, latency_ms INTEGER
);
CREATE TABLE errors (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, component TEXT NOT NULL, message TEXT NOT NULL);
CREATE INDEX tool_calls_session ON tool_calls(agent, session_id);
CREATE INDEX diffs_session ON diffs(agent, session_id);
CREATE INDEX hook_calls_session ON hook_calls(agent, session_id);
CREATE INDEX prompts_session ON prompts(agent, session_id);
CREATE INDEX compactions_session ON compactions(agent, session_id);
CREATE INDEX decisions_session ON decisions(agent, session_id);
`;
const SESSION_TABLES = ["prompts", "tool_calls", "diffs", "compactions", "hook_calls", "decisions"];

interface SessionKey {
  agent: AgentName;
  sessionId: string;
  ts: number;
}

export interface SessionReport {
  session: {
    agent: string;
    id: string;
    model: string | null;
    source: string | null;
    cwd: string | null;
    gitHead: string | null;
    startedAt: number;
    lastEventAt: number;
    endedAt: number | null;
    endReason: string | null;
    turns: number;
  };
  prompts: { ts: number; preview: string }[];
  toolCalls: {
    total: number;
    byTool: Record<string, number>;
    byOutcome: Record<string, number>;
    list: {
      ts: number;
      tool: string;
      outcome: string;
      targets: string[];
      args: string;
      durationMs: number | null;
    }[];
  };
  diffs: { path: string; added: number; removed: number; edits: number; partial: boolean }[];
  compactions: number;
  /**
   * `count` covers every hook the daemon answered; `sync` and the percentiles cover only the hooks the agent waited
   * for. `failures` are hooks that never reached the daemon or timed out (from the client's log).
   */
  hooks: {
    count: number;
    sync: number;
    failures: number;
    p50: number | null;
    p95: number | null;
    max: number | null;
  };
}

const pct = (sorted: number[], p: number) =>
  sorted.length === 0
    ? null
    : (sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? null);

export class EventStore {
  private db!: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();
  private readonly root: string;
  private readonly errorLog: string | null;
  /** Schema version found in an existing file (set by open()). */
  private foundVersion = "";

  /** `root` is the repository root: tool-call paths inside it are stored relative to it. */
  constructor(
    private readonly path: string,
    opts: { root?: string } = {},
  ) {
    this.root = opts.root ?? "";
    this.errorLog = path === ":memory:" ? null : join(dirname(path), HOOK_ERRORS_LOG);
    if (path !== ":memory:") prepareStateDir(dirname(path));
    if (!this.open()) {
      // Written by another schema version. The log is pre-release and local, so keep the old file aside and start a
      // fresh one rather than fail every insert.
      this.db.close();
      const backup = `${path}.v${this.foundVersion}.bak`;
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(path + suffix)) renameSync(path + suffix, backup + suffix);
      this.open();
    }
  }

  /** Opens the database and creates the schema if needed; false when it holds another schema version. */
  private open(): boolean {
    this.db = new DatabaseSync(this.path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    let ok = true;
    this.tx(() => {
      // Checked inside the write transaction, so two processes opening a new file can't both create the schema.
      const hasMeta = this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
        .get();
      if (!hasMeta) {
        this.db.exec(SCHEMA);
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)")
          .run(String(EVENTS_SCHEMA_VERSION));
        return;
      }
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined;
      this.foundVersion = row?.value ?? "unknown";
      ok = this.foundVersion === String(EVENTS_SCHEMA_VERSION);
    });
    return ok;
  }

  /** Runs `fn` in a write transaction, rolling back if it throws (a long-lived connection must never stay inside one). */
  private tx(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private touch(k: SessionKey, cwd?: string): void {
    this.stmt(
      `INSERT INTO sessions (agent, id, cwd, started_at, last_event_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (agent, id) DO UPDATE SET last_event_at = max(last_event_at, excluded.last_event_at),
         cwd = coalesce(sessions.cwd, excluded.cwd)`,
    ).run(k.agent, k.sessionId, cwd ?? null, k.ts, k.ts);
  }

  record(e: NeutralEvent): void {
    this.tx(() => this.recordUnsafe(e));
  }

  private recordUnsafe(e: NeutralEvent): void {
    this.touch(e, e.cwd);
    switch (e.type) {
      case "session_start":
        // A session starts again on resume and after compaction; `source` keeps how it first started.
        this.stmt(
          `UPDATE sessions SET source = coalesce(source, ?), model = coalesce(?, model),
             git_head = coalesce(?, git_head), ended_at = NULL, end_reason = NULL
           WHERE agent = ? AND id = ?`,
        ).run(e.source, e.model ?? null, e.gitHead ?? null, e.agent, e.sessionId);
        break;
      case "prompt": {
        const preview = redactSecrets(e.text).replace(/\s+/g, " ").trim();
        this.stmt(
          "INSERT INTO prompts (agent, session_id, ts, text_hash, text_preview_redacted) VALUES (?, ?, ?, ?, ?)",
        ).run(
          e.agent,
          e.sessionId,
          e.ts,
          createHash("sha256").update(e.text).digest("hex").slice(0, 20),
          preview.length > 120 ? `${preview.slice(0, 119)}…` : preview,
        );
        break;
      }
      case "tool_call_start":
      case "tool_call_end": {
        const { targetPaths, argsSummary } = summarizeToolInput(e.tool, e.input, this.root);
        const outcome = e.type === "tool_call_end" ? e.outcome : "unknown";
        this.stmt(
          `INSERT INTO tool_calls (agent, session_id, tool_use_id, ts, tool, target_paths, args_summary, outcome, duration_ms, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (agent, session_id, tool_use_id) DO UPDATE SET
             outcome = CASE WHEN excluded.outcome = 'unknown' THEN tool_calls.outcome ELSE excluded.outcome END,
             duration_ms = coalesce(excluded.duration_ms, tool_calls.duration_ms),
             ended_at = coalesce(excluded.ended_at, tool_calls.ended_at)`,
        ).run(
          e.agent,
          e.sessionId,
          e.toolUseId,
          e.ts,
          e.tool,
          JSON.stringify(targetPaths),
          argsSummary,
          outcome,
          e.type === "tool_call_end" ? (e.durationMs ?? null) : null,
          e.type === "tool_call_end" ? e.ts : null,
        );
        break;
      }
      case "compaction":
        this.stmt(
          "INSERT INTO compactions (agent, session_id, ts, phase, trigger) VALUES (?, ?, ?, ?, ?)",
        ).run(e.agent, e.sessionId, e.ts, e.phase, e.trigger);
        break;
      case "turn_end":
        this.stmt("UPDATE sessions SET turns = turns + 1 WHERE agent = ? AND id = ?").run(
          e.agent,
          e.sessionId,
        );
        break;
      case "session_end":
        this.stmt("UPDATE sessions SET ended_at = ?, end_reason = ? WHERE agent = ? AND id = ?").run(
          e.ts,
          e.reason,
          e.agent,
          e.sessionId,
        );
        break;
    }
  }

  recordDiff(
    d: SessionKey & {
      toolUseId: string;
      path: string;
      added: number;
      removed: number;
      hashBefore: string | null;
      hashAfter: string | null;
      partial: boolean;
    },
  ): void {
    this.tx(() => {
      this.touch(d);
      this.stmt(
        `INSERT INTO diffs (agent, session_id, tool_use_id, ts, path, added, removed, hash_before, hash_after, partial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        d.agent,
        d.sessionId,
        d.toolUseId,
        d.ts,
        d.path,
        d.added,
        d.removed,
        d.hashBefore,
        d.hashAfter,
        d.partial ? 1 : 0,
      );
    });
  }

  recordHookCall(h: SessionKey & { event: string; sync: boolean; ms: number }): void {
    this.tx(() => {
      this.touch(h);
      this.stmt(
        "INSERT INTO hook_calls (agent, session_id, ts, event, sync, ms) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(h.agent, h.sessionId, h.ts, h.event, h.sync ? 1 : 0, Math.max(0, Math.round(h.ms)));
    });
  }

  recordError(component: string, message: string, ts = Date.now()): void {
    this.stmt("INSERT INTO errors (ts, component, message) VALUES (?, ?, ?)").run(
      ts,
      component,
      redactSecrets(message).slice(0, 500),
    );
  }

  /** Drop sessions (and everything recorded for them) with no activity in `days` days, and old errors. */
  prune(days: number): void {
    const cutoff = Date.now() - days * 86_400_000;
    this.tx(() => {
      const old = "SELECT agent, id FROM sessions WHERE last_event_at < ?";
      for (const table of SESSION_TABLES)
        this.stmt(`DELETE FROM ${table} WHERE (agent, session_id) IN (${old})`).run(cutoff);
      this.stmt("DELETE FROM sessions WHERE last_event_at < ?").run(cutoff);
      this.stmt("DELETE FROM errors WHERE ts < ?").run(cutoff);
    });
  }

  /** Hooks for this session that the client logged as failed (daemon unreachable, timeout, bad response). */
  private hookFailures(sessionId: string): number {
    if (!this.errorLog) return 0;
    let n = 0;
    for (const file of [`${this.errorLog}.1`, this.errorLog]) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) if (line.split("\t")[2] === sessionId) n++;
    }
    return n;
  }

  sessions(): { agent: string; id: string; startedAt: number; lastEventAt: number }[] {
    return this.stmt(
      "SELECT agent, id, started_at AS startedAt, last_event_at AS lastEventAt FROM sessions ORDER BY last_event_at DESC",
    ).all() as { agent: string; id: string; startedAt: number; lastEventAt: number }[];
  }

  /** A session's record: `"last"` is the most recently active session. */
  report(selector: string): SessionReport | null {
    const s = (
      selector === "last"
        ? this.stmt("SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT 1").get()
        : this.stmt("SELECT * FROM sessions WHERE id = ? ORDER BY last_event_at DESC LIMIT 1").get(selector)
    ) as Record<string, string | number | null> | undefined;
    if (!s) return null;
    const key = [s.agent as string, s.id as string] as const;
    const prompts = this.stmt(
      "SELECT ts, text_preview_redacted AS preview FROM prompts WHERE agent = ? AND session_id = ? ORDER BY ts",
    ).all(...key) as { ts: number; preview: string }[];
    const calls = this.stmt(
      `SELECT ts, tool, outcome, target_paths AS targets, args_summary AS args, duration_ms AS durationMs
       FROM tool_calls WHERE agent = ? AND session_id = ? ORDER BY ts, id`,
    ).all(...key) as {
      ts: number;
      tool: string;
      outcome: string;
      targets: string;
      args: string;
      durationMs: number | null;
    }[];
    const byTool: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    for (const c of calls) {
      byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
      byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
    }
    const diffs = (
      this.stmt(
        `SELECT path, SUM(added) AS added, SUM(removed) AS removed, COUNT(*) AS edits, MAX(partial) AS partial
         FROM diffs WHERE agent = ? AND session_id = ? GROUP BY path ORDER BY path`,
      ).all(...key) as { path: string; added: number; removed: number; edits: number; partial: number }[]
    ).map((d) => ({ ...d, partial: d.partial === 1 }));
    const hookRows = this.stmt(
      "SELECT ms, sync FROM hook_calls WHERE agent = ? AND session_id = ? ORDER BY ms",
    ).all(...key) as { ms: number; sync: number }[];
    const ms = hookRows.filter((h) => h.sync === 1).map((h) => h.ms);
    const compactions = (
      this.stmt("SELECT COUNT(*) AS n FROM compactions WHERE agent = ? AND session_id = ?").get(...key) as {
        n: number;
      }
    ).n;
    return {
      session: {
        agent: s.agent as string,
        id: s.id as string,
        model: (s.model as string | null) ?? null,
        source: (s.source as string | null) ?? null,
        cwd: (s.cwd as string | null) ?? null,
        gitHead: (s.git_head as string | null) ?? null,
        startedAt: s.started_at as number,
        lastEventAt: s.last_event_at as number,
        endedAt: (s.ended_at as number | null) ?? null,
        endReason: (s.end_reason as string | null) ?? null,
        turns: s.turns as number,
      },
      prompts,
      toolCalls: {
        total: calls.length,
        byTool,
        byOutcome,
        list: calls.map((c) => ({ ...c, targets: JSON.parse(c.targets) as string[] })),
      },
      diffs,
      compactions,
      hooks: {
        count: hookRows.length,
        sync: ms.length,
        failures: this.hookFailures(s.id as string),
        p50: pct(ms, 50),
        p95: pct(ms, 95),
        max: ms.length ? (ms[ms.length - 1] ?? null) : null,
      },
    };
  }
}
