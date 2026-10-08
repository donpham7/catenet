// What performs a run. The harness core knows only this interface (CLAUDE.md principle 6); agent specifics live in
// the driver.
import type { Condition } from "../schedule.js";
import type { Task } from "../suite.js";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface DriverResult {
  /** `error` is an infrastructure failure (API error, crash): the harness retries it. Agent failures are `ok`. */
  status: "ok" | "error";
  error?: string;
  /** How the agent's session ended, as the agent reports it (e.g. success, error_max_turns, timeout). */
  endReason: string | null;
  durationMs: number;
  usage: AgentUsage | null;
  /** input + output + cache creation + cache read, over every model the session used. */
  tokensTotal: number | null;
  costUsd: number | null;
  turns: number | null;
  /** Tool calls by tool name. */
  toolCalls: Record<string, number>;
  model: string | null;
  /** The agent's version as the session itself reported it (Claude Code: system/init claude_code_version). */
  agentVersion?: string | null;
  /** Why the run doesn't count (isolation or contamination); empty when valid. */
  invalidReasons: string[];
}

export interface RunContext {
  task: Task;
  condition: Condition;
  repo: string;
  /** The Claude Code plugin directory (loaded only in the catenet condition). */
  pluginDir: string;
  /** Environment for the agent and Catenet (CATENET_RUNTIME_DIR for this run). */
  env: NodeJS.ProcessEnv;
  /** Where the driver may write a transcript (outside the repository). */
  transcriptPath: string;
  /** Strings that must never appear in the agent's tool calls (the suite's task files, held-out tests). */
  forbidden: string[];
  /** Strings that must never appear in what the agent's tools returned (the contents of task files). */
  forbiddenInResults?: string[];
}

export interface Driver {
  name: "claude-code" | "patch";
  /** Agent version, recorded in the report. */
  version(): Promise<string>;
  run(ctx: RunContext): Promise<DriverResult>;
}

export const emptyResult = (durationMs: number): DriverResult => ({
  status: "ok",
  endReason: "success",
  durationMs,
  usage: null,
  tokensTotal: null,
  costUsd: null,
  turns: null,
  toolCalls: {},
  model: null,
  invalidReasons: [],
});
