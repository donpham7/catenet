// Contract tests from real payloads recorded in Claude Code 2.1.287 sessions (M3 step 8; paths sanitised). Each line
// must translate, and the session id must survive resume and compaction (docs/HOOK_SCHEMAS.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSyncEvent, respond, translate } from "../src/index.js";

const payloads = readFileSync(join(import.meta.dirname, "payloads/claude-code-2.1.287.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, unknown>);

const EXPECTED_TYPE: Record<string, string> = {
  SessionStart: "session_start",
  UserPromptSubmit: "prompt",
  PreToolUse: "tool_call_start",
  PostToolUse: "tool_call_end",
  PreCompact: "compaction",
  Stop: "turn_end",
  SessionEnd: "session_end",
};

describe("recorded Claude Code payloads", () => {
  it("every payload translates to the expected neutral event", () => {
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      const event = translate(p, 1);
      expect(event, String(p.hook_event_name)).not.toBeNull();
      expect(event?.type).toBe(EXPECTED_TYPE[String(p.hook_event_name)]);
      expect(event?.sessionId).toBe(p.session_id);
      if (event?.type === "tool_call_end") expect(event.outcome).toBe("succeeded");
    }
  });

  it("keeps one session id across startup, resume and compact", () => {
    const starts = payloads.filter((p) => p.hook_event_name === "SessionStart");
    expect(starts.map((p) => p.source)).toEqual(["startup", "resume", "resume", "compact"]);
    expect(new Set(payloads.map((p) => p.session_id)).size).toBe(1);
  });

  it("every PreToolUse/PostToolUse pair shares a tool_use_id", () => {
    const pre = payloads.filter((p) => p.hook_event_name === "PreToolUse").map((p) => p.tool_use_id);
    const post = new Set(
      payloads.filter((p) => p.hook_event_name === "PostToolUse").map((p) => p.tool_use_id),
    );
    for (const id of pre) expect(post.has(id)).toBe(true);
  });

  it("responses for sync events are valid hook JSON and async events get none", () => {
    for (const p of payloads) {
      const name = String(p.hook_event_name);
      const out = respond(name, "ctx");
      if (name === "SessionStart" || name === "PreToolUse")
        expect(JSON.parse(out)).toEqual({
          hookSpecificOutput: { hookEventName: name, additionalContext: "ctx" },
        });
      else expect(out).toBe("");
      expect(typeof isSyncEvent(name)).toBe("boolean");
    }
  });
});
