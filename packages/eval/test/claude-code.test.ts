// The Claude Code driver's isolation and parsing. Conditions differ only by --plugin-dir; a session whose init event
// doesn't match its condition, or that touched the task files, is invalid.
import { describe, expect, it } from "vitest";
import { claudeArgs, claudeEnv, parseTranscript } from "../src/index.js";

const opts = { model: "claude-sonnet-5-5", maxTurns: 40 };
const init = (extra: Record<string, unknown>) =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    model: "claude-sonnet-5-5",
    tools: ["Read", "Edit"],
    mcp_servers: [],
    plugins: [],
    ...extra,
  });
const result = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 6,
  total_cost_usd: 0.21,
  result: "Done.",
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 4000,
  },
  modelUsage: {
    "claude-sonnet-5-5": {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 1000,
      cacheReadInputTokens: 4000,
    },
    "claude-haiku-4-5": {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  },
});
const toolUse = (name: string, input: unknown) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "x" },
        { type: "tool_use", name, input },
      ],
    },
  });
const transcript = (...lines: string[]) => lines.join("\n");

describe("claudeArgs", () => {
  it("differ between conditions only by --plugin-dir", () => {
    const base = claudeArgs("baseline", "/p", opts);
    const cat = claudeArgs("catenet", "/p", opts);
    expect(cat.filter((a) => a !== "--plugin-dir" && a !== "/p")).toEqual(base);
    expect(base).toEqual(expect.arrayContaining(["--setting-sources", "project", "-p"]));
    // --strict-mcp-config would also drop the plugin's own MCP server (M4 pilot).
    expect(base).not.toContain("--strict-mcp-config");
    // claude.ai account connectors stay out of every session (both conditions).
    expect(base[base.indexOf("--settings") + 1]).toBe(JSON.stringify({ disableClaudeAiConnectors: true }));
    expect(base).not.toContain("bypassPermissions");
  });

  it("isolate the session environment, including from a parent Claude Code session", () => {
    const env = claudeEnv({
      PATH: "/bin",
      HOME: "/h",
      LC_ALL: "C",
      CATENET_HOOK_RECORD: "/x",
      CATENET_RUNTIME_DIR: "/run",
      CLAUDE_PROJECT_DIR: "/y",
      CLAUDECODE: "1",
      CLAUDE_EFFORT: "high",
      CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
      MCP_CONNECTION_NONBLOCKING: "1",
      VSCODE_PID: "1",
      ANTHROPIC_API_KEY: "sk-test",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/h",
      LC_ALL: "C",
      CATENET_RUNTIME_DIR: "/run",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
    });
  });
});

describe("parseTranscript", () => {
  it("reads usage over every model, cost, turns and tool calls", () => {
    const p = parseTranscript(
      transcript(
        init({}),
        toolUse("Read", { file_path: "src/a.ts" }),
        toolUse("Read", {}),
        toolUse("Edit", {}),
        result,
      ),
      "baseline",
      [],
    );
    expect(p).toMatchObject({
      finished: true,
      endReason: "success",
      costUsd: 0.21,
      turns: 6,
      model: "claude-sonnet-5-5",
      invalidReasons: [],
    });
    expect(p.tokensTotal).toBe(5165);
    expect(p.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 1000,
      cacheReadTokens: 4000,
    });
    expect(p.toolCalls).toEqual({ Read: 2, Edit: 1 });
  });

  // Recorded in the M4 pilot (Claude Code 2.1.287): built-in plugins load in every session.
  const builtins = [
    { name: "cc-plugin-agents-md", path: "builtin", source: "cc-plugin-agents-md@builtin" },
    { name: "cc-plugin-plugin-authoring", path: "builtin", source: "cc-plugin-plugin-authoring@builtin" },
  ];

  it("accepts a catenet session with the plugin and a connected server, and ignores built-in plugins", () => {
    const p = parseTranscript(
      transcript(
        init({
          plugins: [{ name: "catenet", path: "/p", source: "catenet@inline" }, ...builtins],
          mcp_servers: [{ name: "plugin:catenet:catenet", status: "connected", source: "plugin" }],
          tools: ["Read", "mcp__plugin_catenet_catenet__impact_of"],
        }),
        result,
      ),
      "catenet",
      [],
    );
    expect(p.invalidReasons).toEqual([]);
    expect(
      parseTranscript(transcript(init({ plugins: builtins }), result), "baseline", []).invalidReasons,
    ).toEqual([]);
  });

  it("rejects a session that doesn't match its condition or loaded the user's configuration", () => {
    const leaked = transcript(init({ mcp_servers: [{ name: "catenet", status: "connected" }] }), result);
    expect(parseTranscript(leaked, "baseline", []).invalidReasons).toContain("baseline run loaded Catenet");
    const missing = transcript(init({}), result);
    expect(parseTranscript(missing, "catenet", []).invalidReasons).toContain(
      "catenet run did not load the plugin",
    );
    const user = transcript(
      init({ mcp_servers: [{ name: "github", status: "connected" }], plugins: ["my-plugin"] }),
      result,
    );
    expect(parseTranscript(user, "baseline", []).invalidReasons).toEqual([
      "unexpected MCP servers: github",
      "unexpected plugins: my-plugin",
    ]);
    expect(parseTranscript(result, "baseline", []).invalidReasons).toContain("no system/init event");
  });

  it("rejects a session that touched the task files or held-out tests", () => {
    const p = parseTranscript(
      transcript(init({}), toolUse("Read", { file_path: "/x/fixtures/eval-shop/tasks/a/task.json" }), result),
      "baseline",
      ["/x/fixtures/eval-shop", "holdout"],
    );
    expect(p.invalidReasons).toEqual(["tool call Read touched /x/fixtures/eval-shop"]);
  });

  it("flags a session without a result, and an API failure, as infrastructure problems", () => {
    expect(parseTranscript(init({}), "baseline", []).finished).toBe(false);
    const api = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "API Error: 529 overloaded",
    });
    expect(parseTranscript(transcript(init({}), api), "baseline", []).apiError).toBe(true);
  });

  it("treats any error result but the turn limit as infrastructure (plan limits, expired logins, billing)", () => {
    const res = (extra: Record<string, unknown>) =>
      JSON.stringify({ type: "result", num_turns: 1, ...extra });
    const limit = res({ subtype: "success", is_error: true, result: "Claude AI usage limit reached" });
    expect(parseTranscript(transcript(init({}), limit), "baseline", []).apiError).toBe(true);
    const turns = res({ subtype: "error_max_turns", is_error: true, result: "" });
    expect(parseTranscript(transcript(init({}), turns), "baseline", []).apiError).toBe(false);
  });

  it("falls back to per-message usage when a session has no result (timeout), counting each message once", () => {
    const msg = (id: string, block: unknown) =>
      JSON.stringify({
        type: "assistant",
        message: {
          id,
          content: [block],
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 4,
          },
        },
      });
    // Message m1 arrives as two events (text, then a tool call) with the same usage: counted once.
    const p = parseTranscript(
      transcript(
        init({}),
        msg("m1", { type: "text" }),
        msg("m1", { type: "tool_use", name: "Read", input: {} }),
        msg("m2", { type: "text" }),
      ),
      "baseline",
      [],
    );
    expect(p.finished).toBe(false);
    expect(p.tokensTotal).toBe(20);
  });

  it("records the version the session reports, and flags task files seen in tool results", () => {
    const toolResult = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", content: '{ "acceptance": "holdout/acceptance.test.ts" }' }],
      },
    });
    const p = parseTranscript(
      transcript(init({ claude_code_version: "2.1.293" }), toolResult, result),
      "baseline",
      [],
      ["holdout/"],
    );
    expect(p.agentVersion).toBe("2.1.293");
    expect(p.invalidReasons).toEqual(["a tool result showed holdout/"]);
  });
});
