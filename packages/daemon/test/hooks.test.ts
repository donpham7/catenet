// POST /hook: recording, diffs, context injection (once per file per session), config, fail-open, latency rows.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventStore } from "@catenet/core";
import { afterEach, describe, expect, it } from "vitest";
import { call, createDaemon, type Daemon } from "../src/index.js";
import { fixtureCopy, until } from "./helpers.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function startDaemon(): Promise<{ daemon: Daemon; root: string }> {
  const repo = fixtureCopy("ts-basic");
  cleanups.push(repo.cleanup);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(repo.runtime, { recursive: true });
  const daemon = createDaemon({ root: repo.root, socket: join(repo.runtime, "d.sock"), log: () => {} });
  cleanups.push(() => daemon.stop());
  await daemon.start();
  await until(() => daemon.snapshot().lastIndex, 10_000);
  return { daemon, root: repo.root };
}

const hook = (daemon: Daemon, payload: Record<string, unknown>, agent = "claude-code") =>
  call<{ output: string }>(daemon.socket, "POST", "/hook", {
    agent,
    payload,
    clientStartedAt: Date.now() - 30,
  });

const base = (root: string) => ({
  session_id: "s1",
  cwd: root,
  transcript_path: "/t",
  permission_mode: "default",
});
const ctx = (output: string) =>
  output ? (JSON.parse(output).hookSpecificOutput.additionalContext as string) : "";

describe("daemon /hook", () => {
  it("records a session, injects context at start and before editing shared files, once per file", async () => {
    const { daemon, root } = await startDaemon();
    const start = await hook(daemon, { ...base(root), hook_event_name: "SessionStart", source: "startup" });
    expect(ctx(start.output)).toContain("ts-basic-lib");
    const edit = (file: string, id: string) =>
      hook(daemon, {
        ...base(root),
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_use_id: id,
        tool_input: { file_path: join(root, file) },
      });
    expect(ctx((await edit("src/lib/format.ts", "t1")).output)).toContain("8 files depend on it directly");
    expect((await edit("src/lib/format.ts", "t2")).output).toBe(""); // already told this session
    expect((await edit("src/plugins/loader.ts", "t3")).output).toBe(""); // nothing depends on it
    await hook(daemon, { ...base(root), hook_event_name: "SessionEnd", reason: "other" });
    const report = new EventStore(join(root, ".catenet/events.db")).report("s1");
    expect(report?.session).toMatchObject({ source: "startup", endReason: "other" });
    expect(report?.toolCalls.total).toBe(3);
    expect(report?.hooks.count).toBe(5);
    expect(report?.hooks.withContext).toBe(2); // the session map and the first edit of format.ts
    expect(report?.hooks.p50).toBeGreaterThanOrEqual(30);
  });

  it("records diff stats for edits without storing content", async () => {
    const { daemon, root } = await startDaemon();
    const file = join(root, "src/lib/math.ts");
    const input = { file_path: file, old_string: "x", new_string: "y" };
    await hook(daemon, {
      ...base(root),
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_use_id: "e1",
      tool_input: input,
    });
    writeFileSync(file, `${readFileSync(file, "utf8")}export const extra = 1;\nexport const more = 2;\n`);
    await hook(daemon, {
      ...base(root),
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "e1",
      tool_input: input,
      tool_response: {},
    });
    // A Write with no PreToolUse seen (e.g. daemon restarted mid-call) is recorded as partial, without line counts.
    writeFileSync(join(root, "src/new.ts"), "a\nb\n");
    await hook(daemon, {
      ...base(root),
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_use_id: "w1",
      tool_input: { file_path: join(root, "src/new.ts"), content: "a\nb\n" },
      tool_response: {},
    });
    const store = new EventStore(join(root, ".catenet/events.db"));
    expect(store.report("s1")?.diffs).toEqual([
      { path: "src/lib/math.ts", added: 2, removed: 0, edits: 1, partial: false },
      { path: "src/new.ts", added: 0, removed: 0, edits: 1, partial: true },
    ]);
    store.close();
  });

  it("never reads pipes, devices or files outside the repository, and stays responsive", async () => {
    const { daemon, root } = await startDaemon();
    const fifo = join(root, "src/pipe.ts");
    execFileSync("mkfifo", [fifo]); // open() on a FIFO blocks until a writer appears
    const edit = (file: string, id: string, event: string) =>
      hook(daemon, {
        ...base(root),
        hook_event_name: event,
        tool_name: "Write",
        tool_use_id: id,
        tool_input: { file_path: file, content: "x" },
      });
    const t0 = performance.now();
    for (const [file, id] of [
      [fifo, "f1"],
      ["/dev/zero", "z1"],
    ] as const) {
      await edit(file, id, "PreToolUse");
      await edit(file, id, "PostToolUse");
    }
    expect(performance.now() - t0).toBeLessThan(2000);
    const store = new EventStore(join(root, ".catenet/events.db"));
    const r = store.report("s1");
    store.close();
    expect(r?.toolCalls.total).toBe(2); // both calls are recorded...
    // ...but only the in-repo pipe gets a diff row, marked partial, and nothing outside the repo is read or hashed.
    expect(r?.diffs).toEqual([{ path: "src/pipe.ts", added: 0, removed: 0, edits: 1, partial: true }]);
  });

  it("records no diff for a failed or denied edit", async () => {
    const { daemon, root } = await startDaemon();
    const input = { file_path: join(root, "src/lib/math.ts"), old_string: "a", new_string: "b" };
    for (const [event, id] of [
      ["PostToolUseFailure", "x1"],
      ["PermissionDenied", "x2"],
    ] as const) {
      await hook(daemon, {
        ...base(root),
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_use_id: id,
        tool_input: input,
      });
      await hook(daemon, {
        ...base(root),
        hook_event_name: event,
        tool_name: "Edit",
        tool_use_id: id,
        tool_input: input,
      });
    }
    const store = new EventStore(join(root, ".catenet/events.db"));
    const r = store.report("s1");
    store.close();
    expect(r?.toolCalls.byOutcome).toEqual({ denied: 1, failed: 1 });
    expect(r?.diffs).toEqual([]);
  });

  it("drops oversized request bodies without failing", async () => {
    const { daemon, root } = await startDaemon();
    const big = await hook(daemon, {
      ...base(root),
      hook_event_name: "UserPromptSubmit",
      prompt: "x".repeat(1_100_000),
    });
    expect(big.output).toBe("");
    const ok = await hook(daemon, { ...base(root), hook_event_name: "SessionStart", source: "startup" });
    expect(ctx(ok.output)).toContain("ts-basic-lib");
  });

  it("keeps serving when events.db can't be opened", async () => {
    const { daemon, root } = await startDaemon();
    mkdirSync(join(root, ".catenet/events.db")); // a directory where the database should be
    const r = await hook(daemon, { ...base(root), hook_event_name: "SessionStart", source: "startup" });
    expect(r.output).toBe("");
    expect((await call<{ ok: boolean }>(daemon.socket, "GET", "/health")).ok).toBe(true);
  });

  it("injects edit context when the agent reports paths through a symlink to the root (M4 pilot)", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    const { mkdirSync, symlinkSync, realpathSync } = await import("node:fs");
    mkdirSync(repo.runtime, { recursive: true });
    const alias = join(repo.runtime, "alias");
    symlinkSync(repo.root, alias);
    // The daemon knows the repository by the alias; the agent reports real paths (or the other way round on macOS).
    const daemon = createDaemon({ root: alias, socket: join(repo.runtime, "d.sock"), log: () => {} });
    cleanups.push(() => daemon.stop());
    await daemon.start();
    await until(() => daemon.snapshot().lastIndex, 10_000);
    const real = realpathSync(repo.root);
    const r = await hook(daemon, {
      ...base(real),
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_use_id: "s1",
      tool_input: { file_path: join(real, "src/lib/format.ts") },
    });
    expect(ctx(r.output)).toContain("8 files depend on it directly");
    const store = new EventStore(join(repo.root, ".catenet/events.db"));
    expect(store.report("s1")?.toolCalls.list[0]?.targets).toEqual(["src/lib/format.ts"]);
    store.close();
  });

  it("respects config: injection can be turned off", async () => {
    const { daemon, root } = await startDaemon();
    writeFileSync(
      join(root, ".catenet/config.json"),
      JSON.stringify({ inject: { sessionStart: false, beforeEdit: false } }),
    );
    expect(
      (await hook(daemon, { ...base(root), hook_event_name: "SessionStart", source: "startup" })).output,
    ).toBe("");
    const pre = await hook(daemon, {
      ...base(root),
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: join(root, "src/lib/format.ts") },
    });
    expect(pre.output).toBe("");
  });

  it("fails open on garbage: unknown agent, malformed payload, unknown event", async () => {
    const { daemon, root } = await startDaemon();
    expect((await hook(daemon, { ...base(root), hook_event_name: "SessionStart" }, "nobody")).output).toBe(
      "",
    );
    expect(
      (await call<{ output: string }>(daemon.socket, "POST", "/hook", { agent: "claude-code", payload: "x" }))
        .output,
    ).toBe("");
    expect((await hook(daemon, { ...base(root), hook_event_name: "Notification" })).output).toBe("");
    expect((await call<{ output: string }>(daemon.socket, "POST", "/hook", "not an object")).output).toBe("");
  });
});
