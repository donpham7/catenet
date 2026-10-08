// The Claude Code driver: one headless session per run (`claude -p`, stream-json). Both conditions get identical
// flags except `--plugin-dir`, and each session is isolated from the user's own configuration: project settings only,
// a minimal environment (nothing inherited from a parent Claude Code session), no auto memory (ADR-0016). The
// system/init event proves what was loaded; a run where it doesn't match its condition is invalid.
// No --strict-mcp-config: it also drops the plugin's own MCP server (M4 pilot). Any other server makes a run invalid.
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { run } from "../exec.js";
import type { Condition } from "../schedule.js";
import type { AgentUsage, Driver, DriverResult, RunContext } from "./types.js";

export interface ClaudeCodeOptions {
  model: string;
  maxTurns: number;
  /** The `claude` executable. */
  command?: string;
  timeoutMs?: number;
}

/**
 * Tools the agent may use without a permission prompt (headless runs deny anything else). The same list in both
 * conditions: entries for Catenet's MCP tools are inert when the plugin isn't loaded.
 */
export const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "Glob",
  "Grep",
  "LS",
  "Bash(npm test)",
  "Bash(npm test *)",
  "Bash(npm run typecheck)",
  "Bash(node --test *)",
  "Bash(ls *)",
  "Bash(cat *)",
  "Bash(grep *)",
  "Bash(rg *)",
  "Bash(find *)",
  "Bash(git status)",
  "Bash(git diff *)",
  "Bash(git mv *)",
  "Bash(mv *)",
  "Bash(mkdir *)",
  "Bash(rm src/*)",
  "mcp__plugin_catenet_catenet",
];

/**
 * Settings passed to every session (both conditions): no claude.ai account connectors (Gmail, Drive, ...), which
 * otherwise load on their own and made 2 sessions of the first registered run invalid (docs: settings reference,
 * `disableClaudeAiConnectors`; `--settings` applies even with `--setting-sources project`).
 */
export const SESSION_SETTINGS = JSON.stringify({ disableClaudeAiConnectors: true });

export function claudeArgs(condition: Condition, pluginDir: string, opts: ClaudeCodeOptions): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    opts.model,
    "--max-turns",
    String(opts.maxTurns),
    "--permission-mode",
    "acceptEdits",
    "--setting-sources",
    "project",
    "--settings",
    SESSION_SETTINGS,
    ...(condition === "catenet" ? ["--plugin-dir", pluginDir] : []),
    "--allowedTools",
    ...ALLOWED_TOOLS,
  ];
}

/**
 * Variables a session may inherit. An allow-list, because a harness started from inside Claude Code would otherwise
 * pass on that session's settings (CLAUDE_EFFORT, MCP_CONNECTION_NONBLOCKING, CLAUDE_CODE_ENTRYPOINT, ...; M4 pilot).
 */
const INHERITED = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "TERM",
  "CATENET_RUNTIME_DIR",
];

/** Environment for a session: a minimal inherited set, no auto memory, no nonessential traffic. */
export function claudeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of INHERITED) if (base[k] !== undefined) env[k] = base[k];
  for (const [k, v] of Object.entries(base)) if (k.startsWith("LC_")) env[k] = v;
  // DISABLE_AUTOUPDATER: Claude Code updated itself in the middle of the first registered run (M4 review).
  return {
    ...env,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const names = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) =>
        typeof x === "string" ? x : String((x as { name?: unknown } | null)?.name ?? JSON.stringify(x)),
      )
    : [];
const isCatenet = (name: string) => /catenet/i.test(name);
/** Claude Code's own built-in plugins load in every session, in both conditions alike. */
const isBuiltin = (p: unknown) =>
  typeof p === "object" &&
  p !== null &&
  ((p as { path?: unknown }).path === "builtin" ||
    String((p as { source?: unknown }).source ?? "").endsWith("@builtin"));

export type ParsedTranscript = Omit<DriverResult, "status" | "durationMs" | "error"> & {
  /** The session reported a final result event. */
  finished: boolean;
  /** The result says the API failed (infrastructure, not the agent). */
  apiError: boolean;
};

/** Reads a stream-json transcript: usage, tool calls, and whether the session matched its condition. */
export function parseTranscript(
  text: string,
  condition: Condition,
  forbidden: readonly string[],
  forbiddenInResults: readonly string[] = [],
): ParsedTranscript {
  const toolCalls: Record<string, number> = {};
  /** Per-message usage, by message id (stream-json repeats a message's usage on each of its content blocks). */
  const messageUsage = new Map<string, Record<string, unknown>>();
  const invalid: string[] = [];
  let init: Record<string, unknown> | null = null;
  let result: Record<string, unknown> | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") init = event;
    if (event.type === "result") result = event;
    if (event.type === "user") {
      // Tool results: reading a task file or a held-out test would show up here even if the path was disguised.
      const content = (event.message as { content?: unknown } | undefined)?.content;
      for (const block of Array.isArray(content) ? content : []) {
        if ((block as { type?: unknown }).type !== "tool_result") continue;
        const body = JSON.stringify((block as { content?: unknown }).content ?? "");
        for (const f of forbiddenInResults) if (body.includes(f)) invalid.push(`a tool result showed ${f}`);
      }
    }
    if (event.type === "assistant") {
      const message = event.message as { id?: unknown; usage?: unknown } | undefined;
      if (typeof message?.id === "string" && message.usage && typeof message.usage === "object")
        messageUsage.set(message.id, message.usage as Record<string, unknown>);
      const content = (event.message as { content?: unknown } | undefined)?.content;
      for (const block of Array.isArray(content) ? content : []) {
        const b = block as { type?: unknown; name?: unknown; input?: unknown };
        if (b.type !== "tool_use" || typeof b.name !== "string") continue;
        toolCalls[b.name] = (toolCalls[b.name] ?? 0) + 1;
        const input = JSON.stringify(b.input ?? {});
        for (const f of forbidden) if (input.includes(f)) invalid.push(`tool call ${b.name} touched ${f}`);
      }
    }
  }

  if (!init) invalid.push("no system/init event");
  else {
    const servers = (Array.isArray(init.mcp_servers) ? init.mcp_servers : []) as {
      name?: string;
      status?: string;
    }[];
    const plugins = names((Array.isArray(init.plugins) ? init.plugins : []).filter((p) => !isBuiltin(p)));
    const tools = names(init.tools);
    const other = servers.filter((s) => !isCatenet(String(s.name ?? "")));
    if (other.length) invalid.push(`unexpected MCP servers: ${other.map((s) => s.name).join(", ")}`);
    const otherPlugins = plugins.filter((p) => !isCatenet(p));
    if (otherPlugins.length) invalid.push(`unexpected plugins: ${otherPlugins.join(", ")}`);
    const catenetServers = servers.filter((s) => isCatenet(String(s.name ?? "")));
    if (condition === "baseline") {
      if (catenetServers.length || plugins.some(isCatenet) || tools.some(isCatenet))
        invalid.push("baseline run loaded Catenet");
    } else {
      if (!plugins.some(isCatenet)) invalid.push("catenet run did not load the plugin");
      if (!catenetServers.some((s) => s.status === "connected"))
        invalid.push("catenet run has no connected Catenet MCP server");
    }
  }

  let usage: AgentUsage | null = null;
  let tokensTotal: number | null = null;
  if (result) {
    const u = (result.usage ?? {}) as Record<string, unknown>;
    usage = {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheCreationTokens: num(u.cache_creation_input_tokens ?? u.cache_creation_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens ?? u.cache_read_tokens),
    };
    // modelUsage covers every model the session used (e.g. a smaller model for subtasks); fall back to usage.
    const perModel = Object.values((result.modelUsage ?? {}) as Record<string, Record<string, unknown>>);
    tokensTotal = perModel.length
      ? perModel.reduce(
          (sum, m) =>
            sum +
            num(m.inputTokens) +
            num(m.outputTokens) +
            num(m.cacheCreationInputTokens) +
            num(m.cacheReadInputTokens),
          0,
        )
      : usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  } else if (messageUsage.size > 0) {
    // No result event (timeout, crash): sum what the messages reported, so a long session isn't silently dropped
    // from the token comparisons (M4 review).
    usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    for (const u of messageUsage.values()) {
      usage.inputTokens += num(u.input_tokens);
      usage.outputTokens += num(u.output_tokens);
      usage.cacheCreationTokens += num(u.cache_creation_input_tokens);
      usage.cacheReadTokens += num(u.cache_read_input_tokens);
    }
    tokensTotal = usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  }
  return {
    finished: result !== null,
    // Any error result other than running out of turns is the infrastructure's, not the agent's: API errors, plan
    // usage limits, expired logins, billing (M4 review: those were scored as an agent that did nothing).
    apiError: result !== null && result.is_error === true && result.subtype !== "error_max_turns",
    endReason: result ? String(result.subtype ?? "unknown") : null,
    usage,
    tokensTotal,
    costUsd: result ? num(result.total_cost_usd) : null,
    turns: result ? num(result.num_turns) : null,
    toolCalls,
    model: init && typeof init.model === "string" ? init.model : null,
    agentVersion: init && typeof init.claude_code_version === "string" ? init.claude_code_version : null,
    invalidReasons: [...new Set(invalid)],
  };
}

/** The real path of an executable on PATH, so every session runs the same binary even if the PATH entry moves. */
function pinBinary(command: string): string {
  const candidates = command.includes("/")
    ? [command]
    : (process.env.PATH ?? "").split(delimiter).map((d) => join(d, command));
  const found = candidates.find((c) => existsSync(c));
  return found ? realpathSync(found) : command;
}

export function createClaudeCodeDriver(opts: ClaudeCodeOptions): Driver {
  // Pinned once: Claude Code's updater re-points ~/.local/bin/claude, which switched versions mid-run (M4 review).
  const command = pinBinary(opts.command ?? "claude");
  return {
    name: "claude-code",
    async version() {
      const r = await run(command, ["--version"], { cwd: process.cwd(), timeoutMs: 30_000 });
      return r.stdout.trim() || "unknown";
    },
    async run(ctx: RunContext): Promise<DriverResult> {
      const started = performance.now();
      const r = await run(command, claudeArgs(ctx.condition, ctx.pluginDir, opts), {
        cwd: ctx.repo,
        env: claudeEnv(ctx.env),
        timeoutMs: opts.timeoutMs ?? 15 * 60_000,
        input: ctx.task.prompt,
      });
      writeFileSync(ctx.transcriptPath, r.stdout);
      const parsed = parseTranscript(r.stdout, ctx.condition, ctx.forbidden, ctx.forbiddenInResults ?? []);
      const durationMs = performance.now() - started;
      const { finished, apiError, ...rest } = parsed;
      if (r.timedOut) return { ...rest, status: "ok", endReason: "timeout", durationMs };
      if (!finished || apiError)
        return {
          ...rest,
          status: "error",
          error: apiError
            ? `error result: ${String(parsed.endReason)}`
            : `claude exited ${r.code} without a result: ${r.stderr.slice(0, 500)}`,
          durationMs,
        };
      return { ...rest, status: "ok", durationMs };
    },
  };
}
