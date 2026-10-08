// M3 event log: redaction, diff stats, recording, retention and the session report.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalPath,
  EventSchemaError,
  EventStore,
  lineDiff,
  redactSecrets,
  repoRelative,
  summarizeToolInput,
} from "../src/index.js";

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0))
    rmSync(t, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cne-"));
  temps.push(dir);
  return dir;
}
function store(root?: string): EventStore {
  return new EventStore(join(tempDir(), "events.db"), { root });
}

describe("redactSecrets", () => {
  const cases: [string, string][] = [
    ["aws AKIAIOSFODNN7EXAMPLE key", "aws [REDACTED] key"],
    ["token ghp_1234567890abcdefghijklmnopqrstuvwxyzAB", "token [REDACTED]"],
    ["export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123", "export OPENAI_API_KEY=[REDACTED]"],
    [
      "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abcdef'",
      "curl -H 'Authorization: Bearer [REDACTED]'",
    ],
    ["password = hunter2!", "password = [REDACTED]"],
    ['{"apiToken": "abc123secretvalue"}', '{"apiToken": "[REDACTED]"}'],
    ["xoxb-123456789012-abcdefghij", "[REDACTED]"],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", "[REDACTED]"],
    ["git status && npm test", "git status && npm test"],
    // Quoted values may contain spaces.
    ['password: "correct horse battery staple"', 'password: "[REDACTED]"'],
    ['{"password": "my pass phrase"}', '{"password": "[REDACTED]"}'],
    ["TOKEN='x y z'", "TOKEN='[REDACTED]'"],
    // Credentials in URLs and command-line flags.
    ["psql postgres://admin:S3cr3t@db/app", "psql postgres://admin:[REDACTED]@db/app"],
    ["curl -u admin:hunter2 https://x", "curl -u admin:[REDACTED] https://x"],
    ["docker login -p hunter2 registry", "docker login -p [REDACTED] registry"],
    ["deploy --password hunter2", "deploy --password [REDACTED]"],
    ["tool --api-key=abc123", "tool --api-key=[REDACTED]"],
    ["mysql -uroot -pHunter2 db", "mysql -uroot -p[REDACTED] db"],
    [
      "https://b.s3.amazonaws.com/k?X-Amz-Signature=abcdef&x=1",
      "https://b.s3.amazonaws.com/k?X-Amz-Signature=[REDACTED]&x=1",
    ],
    // Other token formats.
    ["key sk_live_abcdefghijkl123", "key [REDACTED]"],
    ["glpat-abcdefghijklmnopqrstu", "[REDACTED]"],
    ["AIzaSyA1234567890abcdefghijklmnopqrstuv", "[REDACTED]"],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: Basic [REDACTED]"],
    // Ordinary commands stay readable.
    ["mkdir -p src/lib && git log -p", "mkdir -p src/lib && git log -p"],
    ["npm test -- --passWithNoTests", "npm test -- --passWithNoTests"],
  ];
  for (const [input, expected] of cases) {
    it(`redacts ${input.slice(0, 24)}…`, () => expect(redactSecrets(input)).toBe(expected));
  }
});

describe("lineDiff", () => {
  it("counts added and removed lines as a multiset", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual({ added: 2, removed: 1 });
    expect(lineDiff(null, "x\ny\n")).toEqual({ added: 2, removed: 0 });
    expect(lineDiff("x\ny\n", null)).toEqual({ added: 0, removed: 2 });
    expect(lineDiff("same\n", "same\n")).toEqual({ added: 0, removed: 0 });
  });
});

describe("summarizeToolInput", () => {
  it("keeps paths and a redacted command, never file contents", () => {
    expect(
      summarizeToolInput("Edit", { file_path: "/r/src/a.ts", old_string: "SECRET", new_string: "x" }, "/r"),
    ).toEqual({
      targetPaths: ["src/a.ts"],
      argsSummary: "src/a.ts",
    });
    expect(summarizeToolInput("Bash", { command: "API_KEY=abcdef123456789 npm run deploy" }, "/r")).toEqual({
      targetPaths: [],
      argsSummary: "API_KEY=[REDACTED] npm run deploy",
    });
    expect(
      summarizeToolInput("Write", { file_path: "/elsewhere/x.ts", content: "..." }, "/r").targetPaths,
    ).toEqual(["/elsewhere/x.ts"]);
  });

  it("keeps a shell command's first line only, so heredoc and here-string bodies are never stored", () => {
    const heredoc = "cat > config/prod.env <<'EOF'\nCUSTOMER_LIST=alice@corp.example\nNOTES: plans\nEOF";
    expect(summarizeToolInput("Bash", { command: heredoc }, "/r").argsSummary).toBe(
      "cat > config/prod.env <<'EOF' …",
    );
    expect(summarizeToolInput("Bash", { command: "cat <<< 'body text' > f" }, "/r").argsSummary).toBe(
      "cat <<< …",
    );
    expect(summarizeToolInput("Bash", { command: "npm test" }, "/r").argsSummary).toBe("npm test");
  });
});

describe("repoRelative", () => {
  it("treats a path reached through a symlink as inside the repository (macOS /var -> /private/var)", () => {
    const dir = tempDir();
    const real = join(dir, "real");
    mkdirSync(join(real, "src"), { recursive: true });
    writeFileSync(join(real, "src", "a.ts"), "");
    symlinkSync(real, join(dir, "alias"));
    expect(repoRelative(join(real, "src", "a.ts"), join(dir, "alias"))).toBe("src/a.ts");
    expect(repoRelative(join(dir, "alias", "src", "new.ts"), real)).toBe("src/new.ts"); // not created yet
    expect(repoRelative(join(dir, "elsewhere.ts"), real)).toBeNull();
    expect(canonicalPath(join(dir, "alias", "src"))).toBe(canonicalPath(join(real, "src")));
    // A symlinked file inside the repository keeps its own name, wherever it points (the indexer keys it that way).
    writeFileSync(join(dir, "outside.ts"), "");
    symlinkSync(join(dir, "outside.ts"), join(real, "src", "linked.ts"));
    expect(repoRelative(join(real, "src", "linked.ts"), real)).toBe("src/linked.ts");
  });
});

describe("EventStore", () => {
  it("records a session and reports it", () => {
    const s = store();
    const base = { agent: "claude-code" as const, sessionId: "s1", cwd: "/r" };
    s.record({ ...base, ts: 1000, type: "session_start", source: "startup", gitHead: "abc123" });
    s.record({ ...base, ts: 1100, type: "prompt", text: "fix it, my password = hunter2" });
    s.record({
      ...base,
      ts: 1200,
      type: "tool_call_start",
      toolUseId: "t1",
      tool: "Edit",
      input: { file_path: "/r/src/a.ts" },
    });
    s.record({
      ...base,
      ts: 1300,
      type: "tool_call_end",
      toolUseId: "t1",
      tool: "Edit",
      input: { file_path: "/r/src/a.ts" },
      outcome: "succeeded",
      durationMs: 12,
    });
    s.recordDiff({
      ...base,
      ts: 1300,
      toolUseId: "t1",
      path: "src/a.ts",
      added: 3,
      removed: 1,
      hashBefore: "h1",
      hashAfter: "h2",
      partial: false,
    });
    s.record({
      ...base,
      ts: 1400,
      type: "tool_call_end",
      toolUseId: "t2",
      tool: "Bash",
      input: { command: "npm test" },
      outcome: "failed",
    });
    s.record({
      ...base,
      ts: 1450,
      type: "tool_call_start",
      toolUseId: "t3",
      tool: "Write",
      input: { file_path: "/r/b.ts" },
    });
    s.recordHookCall({ ...base, ts: 1200, event: "PreToolUse", sync: true, ms: 40 });
    s.recordHookCall({ ...base, ts: 1250, event: "SessionStart", sync: true, ms: 60 });
    s.recordHookCall({ ...base, ts: 1300, event: "PostToolUse", sync: false, ms: 500 });
    s.record({ ...base, ts: 2000, type: "session_end", reason: "other" });

    const r = s.report("last");
    expect(r?.session).toMatchObject({
      agent: "claude-code",
      id: "s1",
      gitHead: "abc123",
      startedAt: 1000,
      endedAt: 2000,
      endReason: "other",
    });
    expect(r?.prompts).toEqual([{ ts: 1100, preview: "fix it, my password = [REDACTED]" }]);
    expect(r?.toolCalls.byTool).toEqual({ Bash: 1, Edit: 1, Write: 1 });
    expect(r?.toolCalls.byOutcome).toEqual({ failed: 1, succeeded: 1, unknown: 1 });
    expect(r?.diffs).toEqual([{ path: "src/a.ts", added: 3, removed: 1, edits: 1, partial: false }]);
    // Percentiles cover only hooks the agent waited for; the async PostToolUse is counted but not timed.
    expect(r?.hooks).toEqual({ count: 3, sync: 2, withContext: 0, failures: 0, p50: 40, p95: 60, max: 60 });
    s.close();
  });

  it("keeps tool calls unique per tool_use_id and merges start and end", () => {
    const s = store();
    const base = { agent: "claude-code" as const, sessionId: "s1" };
    s.record({
      ...base,
      ts: 1,
      type: "tool_call_start",
      toolUseId: "t1",
      tool: "Read",
      input: { file_path: "a" },
    });
    s.record({
      ...base,
      ts: 2,
      type: "tool_call_end",
      toolUseId: "t1",
      tool: "Read",
      input: { file_path: "a" },
      outcome: "succeeded",
    });
    expect(s.report("s1")?.toolCalls.total).toBe(1);
    s.close();
  });

  it("stores tool-call paths relative to the repository root, not the session's working directory", () => {
    const s = store("/r");
    const base = { agent: "claude-code" as const, sessionId: "s1", cwd: "/r/packages/core" };
    s.record({
      ...base,
      ts: 1,
      type: "tool_call_start",
      toolUseId: "t1",
      tool: "Edit",
      input: { file_path: "/r/packages/core/x.ts" },
    });
    s.record({
      ...base,
      ts: 2,
      type: "tool_call_start",
      toolUseId: "t2",
      tool: "Edit",
      input: { file_path: "/r/packages/cli/y.ts" },
    });
    expect(s.report("s1")?.toolCalls.list.map((c) => c.targets)).toEqual([
      ["packages/core/x.ts"],
      ["packages/cli/y.ts"],
    ]);
    s.close();
  });

  it("keeps the outcome when a tool call's end arrives before its start (async hooks)", () => {
    const s = store();
    const base = { agent: "claude-code" as const, sessionId: "s1" };
    const input = { file_path: "a" };
    s.record({
      ...base,
      ts: 2,
      type: "tool_call_end",
      toolUseId: "t1",
      tool: "Edit",
      input,
      outcome: "succeeded",
    });
    s.record({ ...base, ts: 1, type: "tool_call_start", toolUseId: "t1", tool: "Edit", input });
    expect(s.report("s1")?.toolCalls.byOutcome).toEqual({ succeeded: 1 });
    s.close();
  });

  it("keeps how a session first started across resume and compaction, and clears the end on resume", () => {
    const s = store();
    const base = { agent: "claude-code" as const, sessionId: "s1" };
    s.record({ ...base, ts: 1, type: "session_start", source: "startup" });
    s.record({ ...base, ts: 2, type: "session_end", reason: "other" });
    s.record({ ...base, ts: 3, type: "session_start", source: "resume" });
    s.record({ ...base, ts: 4, type: "session_start", source: "compact", model: "m" });
    expect(s.report("s1")?.session).toMatchObject({
      source: "startup",
      model: "m",
      endedAt: null,
      endReason: null,
    });
    s.close();
  });

  it("returns null for an unknown session", () => {
    const s = store();
    expect(s.report("last")).toBeNull();
    expect(s.report("nope")).toBeNull();
    s.close();
  });

  it("counts a session's hook failures from the hook client's log", () => {
    const dir = tempDir();
    const s = new EventStore(join(dir, "events.db"));
    s.record({ agent: "claude-code", sessionId: "s1", ts: 1, type: "session_start", source: "startup" });
    writeFileSync(join(dir, "hook-errors.log.1"), "2026-01-01T00:00:00Z\tStop\ts1\tno daemon.json\n");
    appendFileSync(join(dir, "hook-errors.log"), "2026-01-01T00:00:01Z\tPreToolUse\ts1\ttimeout\n");
    appendFileSync(join(dir, "hook-errors.log"), "2026-01-01T00:00:02Z\tPreToolUse\tother\ttimeout\n");
    expect(s.report("s1")?.hooks.failures).toBe(2);
    s.close();
  });

  it("rolls back a failed write, so later writes still commit", () => {
    const dir = tempDir();
    const s = new EventStore(join(dir, "events.db"));
    expect(() =>
      s.record({
        agent: "claude-code",
        sessionId: "s1",
        ts: 1,
        type: "session_end",
        reason: null as unknown as string,
      }),
    ).not.toThrow(); // end_reason is nullable: no error expected here
    expect(() =>
      s.recordDiff({
        agent: "claude-code",
        sessionId: "s1",
        ts: 1,
        toolUseId: "t",
        path: null as unknown as string,
        added: 0,
        removed: 0,
        hashBefore: null,
        hashAfter: null,
        partial: false,
      }),
    ).toThrow();
    s.record({ agent: "claude-code", sessionId: "s2", ts: 2, type: "session_start", source: "startup" });
    const other = new EventStore(join(dir, "events.db"));
    expect(
      other
        .sessions()
        .map((x) => x.id)
        .sort(),
    ).toEqual(["s1", "s2"]);
    other.close();
    s.close();
  });

  it("sets aside a database written by another schema version and starts a fresh one", () => {
    const dir = tempDir();
    const path = join(dir, "events.db");
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '1');",
    );
    old.close();
    const s = new EventStore(path);
    s.record({ agent: "claude-code", sessionId: "s1", ts: 1, type: "session_start", source: "startup" });
    expect(s.sessions()).toHaveLength(1);
    expect(existsSync(`${path}.v1.bak`)).toBe(true);
    s.close();
  });

  it("never overwrites an earlier backup, and lets readers refuse to upgrade", () => {
    const dir = tempDir();
    const path = join(dir, "events.db");
    const oldFile = (content: string) => {
      const db = new DatabaseSync(path);
      db.exec(
        `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '1'); CREATE TABLE note (t TEXT); INSERT INTO note VALUES ('${content}');`,
      );
      db.close();
    };
    oldFile("first");
    expect(() => new EventStore(path, { upgrade: false })).toThrow(EventSchemaError);
    expect(existsSync(`${path}.v1.bak`)).toBe(false); // a reader leaves it alone
    new EventStore(path).close();
    rmSync(path);
    for (const s of ["-wal", "-shm"]) rmSync(path + s, { force: true });
    oldFile("second");
    new EventStore(path).close();
    const read = (p: string) => {
      const db = new DatabaseSync(p);
      const t = (db.prepare("SELECT t FROM note").get() as { t: string }).t;
      db.close();
      return t;
    };
    expect(read(`${path}.v1.bak`)).toBe("first");
    expect(read(`${path}.v1.2.bak`)).toBe("second");
  });

  it("writes .catenet/.gitignore when it creates the directory", () => {
    const dir = tempDir();
    new EventStore(join(dir, ".catenet", "events.db")).close();
    expect(existsSync(join(dir, ".catenet", ".gitignore"))).toBe(true);
  });

  it("prunes events older than the retention window, with everything recorded for them", () => {
    const s = store();
    const old = Date.now() - 40 * 86_400_000;
    s.record({ agent: "claude-code", sessionId: "old", ts: old, type: "session_start", source: "startup" });
    s.record({ agent: "claude-code", sessionId: "old", ts: old, type: "prompt", text: "hi" });
    s.record({
      agent: "claude-code",
      sessionId: "old",
      ts: old,
      type: "compaction",
      phase: "pre",
      trigger: "manual",
    });
    s.recordHookCall({ agent: "claude-code", sessionId: "old", ts: old, event: "Stop", sync: true, ms: 5 });
    s.record({
      agent: "claude-code",
      sessionId: "new",
      ts: Date.now(),
      type: "session_start",
      source: "startup",
    });
    s.prune(30);
    expect(s.sessions().map((x) => x.id)).toEqual(["new"]);
    // The old session's rows are gone too: a session recorded again under the same id starts empty.
    s.record({ agent: "claude-code", sessionId: "old", ts: Date.now(), type: "turn_end" });
    expect(s.report("old")).toMatchObject({ prompts: [], compactions: 0, hooks: { count: 0 } });
    s.close();
  });
});
