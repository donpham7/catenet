// Claude Code hook payloads -> neutral events (CLAUDE.md principle 6). Shapes are from docs/HOOK_SCHEMAS.md; any
// payload we don't understand is ignored, never an error.
import type { NeutralEvent } from "@catenet/core";

type Payload = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Events whose hook Claude Code waits for (configured without `async`), so a response can carry context. */
const SYNC_EVENTS = new Set(["SessionStart", "PreToolUse", "Stop", "SessionEnd"]);
/** Sync events whose response may include `hookSpecificOutput.additionalContext`. */
const CONTEXT_EVENTS = new Set(["SessionStart", "PreToolUse"]);

export const isSyncEvent = (event: string) => SYNC_EVENTS.has(event);

export function translate(payload: unknown, ts = Date.now()): NeutralEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Payload;
  const sessionId = str(p.session_id);
  const event = str(p.hook_event_name);
  if (!sessionId || !event) return null;
  const base = { agent: "claude-code" as const, sessionId, ts, ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}) };
  const tool = str(p.tool_name);
  const toolUseId = str(p.tool_use_id);
  switch (event) {
    case "SessionStart":
      return {
        ...base,
        type: "session_start",
        source: str(p.source) ?? "unknown",
        ...(str(p.model) ? { model: str(p.model) } : {}),
      };
    case "UserPromptSubmit":
      return typeof p.prompt === "string" ? { ...base, type: "prompt", text: p.prompt } : null;
    case "PreToolUse":
      return tool && toolUseId
        ? { ...base, type: "tool_call_start", toolUseId, tool, input: obj(p.tool_input) }
        : null;
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PermissionDenied": {
      if (!tool || !toolUseId) return null;
      const outcome =
        event === "PostToolUse" ? "succeeded" : event === "PostToolUseFailure" ? "failed" : "denied";
      return {
        ...base,
        type: "tool_call_end",
        toolUseId,
        tool,
        input: obj(p.tool_input),
        outcome,
        ...(typeof p.duration_ms === "number" ? { durationMs: p.duration_ms } : {}),
      };
    }
    case "PreCompact":
    case "PostCompact":
      return {
        ...base,
        type: "compaction",
        phase: event === "PreCompact" ? "pre" : "post",
        trigger: str(p.trigger) ?? "unknown",
      };
    case "Stop":
      return { ...base, type: "turn_end" };
    case "SessionEnd":
      return { ...base, type: "session_end", reason: str(p.reason) ?? "other" };
    default:
      return null;
  }
}

/**
 * The hook's stdout for Claude Code. M3 only ever adds context; it never emits `permissionDecision` (an explicit
 * `allow` would skip the user's own permission prompts; HOOK_SCHEMAS.md section 10).
 */
export function respond(event: string, context: string | null): string {
  if (!context || !CONTEXT_EVENTS.has(event)) return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
}
