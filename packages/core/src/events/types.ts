// Agent-neutral events (CLAUDE.md principle 6). Adapters translate agent hook payloads into these; the core never
// sees an agent-specific shape.

export type AgentName = "claude-code" | "codex";
export type ToolOutcome = "succeeded" | "failed" | "denied" | "unknown";

interface Base {
  agent: AgentName;
  sessionId: string;
  ts: number;
  cwd?: string;
}

export type NeutralEvent =
  | (Base & { type: "session_start"; source: string; model?: string; gitHead?: string })
  | (Base & { type: "prompt"; text: string })
  | (Base & { type: "tool_call_start"; toolUseId: string; tool: string; input: Record<string, unknown> })
  | (Base & {
      type: "tool_call_end";
      toolUseId: string;
      tool: string;
      input: Record<string, unknown>;
      outcome: Exclude<ToolOutcome, "unknown">;
      durationMs?: number;
    })
  | (Base & { type: "compaction"; phase: "pre" | "post"; trigger: string })
  | (Base & { type: "turn_end" })
  | (Base & { type: "session_end"; reason: string });

/** Tools whose edits get before/after diff stats. */
export const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** The file an edit tool targets. */
export function editTarget(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.notebook_path;
  return typeof p === "string" ? p : null;
}
