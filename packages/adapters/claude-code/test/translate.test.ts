// Contract tests: Claude Code hook payloads (docs/HOOK_SCHEMAS.md verbatim shapes) -> neutral events, and our
// responses -> exactly what Claude Code accepts. Recorded real payloads are added under test/payloads/ in M3 step 8.
import { describe, expect, it } from "vitest";
import { isSyncEvent, respond, translate } from "../src/index.js";

const common = {
  session_id: "abc123",
  transcript_path: "/home/user/.claude/projects/x/transcript.jsonl",
  cwd: "/home/user/my-project",
  permission_mode: "default",
};
const T = 1_000;

describe("translate", () => {
  it("SessionStart", () => {
    expect(
      translate({ ...common, hook_event_name: "SessionStart", source: "startup", model: "claude-x" }, T),
    ).toEqual({
      type: "session_start",
      agent: "claude-code",
      sessionId: "abc123",
      cwd: "/home/user/my-project",
      ts: T,
      source: "startup",
      model: "claude-x",
    });
  });

  it("UserPromptSubmit", () => {
    expect(
      translate({ ...common, hook_event_name: "UserPromptSubmit", prompt: "fix the bug" }, T),
    ).toMatchObject({
      type: "prompt",
      text: "fix the bug",
    });
  });

  it("PreToolUse (Bash, verbatim HOOK_SCHEMAS example)", () => {
    const payload = {
      ...common,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "npm test",
        description: "Run test suite",
        timeout: 120000,
        run_in_background: false,
      },
      tool_use_id: "toolu_01ABC123",
    };
    expect(translate(payload, T)).toMatchObject({
      type: "tool_call_start",
      toolUseId: "toolu_01ABC123",
      tool: "Bash",
      input: { command: "npm test" },
    });
  });

  it("PostToolUse, PostToolUseFailure and PermissionDenied end a tool call with an outcome", () => {
    const base = {
      ...common,
      tool_name: "Write",
      tool_input: { file_path: "/p/a.txt", content: "x" },
      tool_use_id: "t1",
    };
    expect(
      translate(
        { ...base, hook_event_name: "PostToolUse", tool_response: { type: "create" }, duration_ms: 12 },
        T,
      ),
    ).toMatchObject({
      type: "tool_call_end",
      outcome: "succeeded",
      durationMs: 12,
    });
    expect(translate({ ...base, hook_event_name: "PostToolUseFailure", error: "boom" }, T)).toMatchObject({
      outcome: "failed",
    });
    expect(translate({ ...base, hook_event_name: "PermissionDenied" }, T)).toMatchObject({
      outcome: "denied",
    });
  });

  it("compaction, Stop and SessionEnd", () => {
    expect(translate({ ...common, hook_event_name: "PreCompact", trigger: "auto" }, T)).toMatchObject({
      type: "compaction",
      phase: "pre",
      trigger: "auto",
    });
    expect(translate({ ...common, hook_event_name: "PostCompact", trigger: "manual" }, T)).toMatchObject({
      phase: "post",
    });
    expect(translate({ ...common, hook_event_name: "Stop" }, T)).toMatchObject({ type: "turn_end" });
    expect(translate({ ...common, hook_event_name: "SessionEnd", reason: "clear" }, T)).toMatchObject({
      type: "session_end",
      reason: "clear",
    });
  });

  it("ignores events Catenet doesn't use and malformed payloads", () => {
    expect(translate({ ...common, hook_event_name: "Notification" }, T)).toBeNull();
    expect(translate({ hook_event_name: "PreToolUse" }, T)).toBeNull(); // no session_id / tool
    expect(translate(null, T)).toBeNull();
    expect(translate("nope", T)).toBeNull();
  });
});

describe("respond", () => {
  it("emits additionalContext only for sync events that can carry it, and never a permission decision", () => {
    expect(JSON.parse(respond("PreToolUse", "ctx"))).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "ctx" },
    });
    expect(JSON.parse(respond("SessionStart", "map"))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "map" },
    });
    expect(respond("PreToolUse", null)).toBe("");
    expect(respond("PostToolUse", "ctx")).toBe("");
    expect(respond("Stop", "ctx")).toBe("");
  });

  it("knows which events are synchronous", () => {
    expect(isSyncEvent("PreToolUse")).toBe(true);
    expect(isSyncEvent("SessionStart")).toBe(true);
    expect(isSyncEvent("PostToolUse")).toBe(false);
  });
});
