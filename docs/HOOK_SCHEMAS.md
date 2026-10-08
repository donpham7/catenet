# Hook schemas

Source of truth for agent hook payloads. **Do not guess payload shapes; update this file from the official docs.**

- Fetched: **2026-10-04**, from the official docs as raw markdown (append `.md` to a page URL).
- Claude Code: https://code.claude.com/docs/en/hooks (docs.claude.com redirects here), plus `/hooks-guide`, `/headless`,
  `/permission-modes`, `/memory`, `/plugins/manifest-reference`, `/cli-reference`.
- Codex: https://learn.chatgpt.com/docs/hooks (developers.openai.com/codex/* now redirects to learn.chatgpt.com/docs/*), plus
  `/config-file/config-reference`, `/non-interactive-mode`, `/extend/mcp`, `/agent-configuration/agents-md`.
  Full wire schemas are linked from the docs at https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated
  (not reachable when this was written; check it in M8).
- Items marked **UNCONFIRMED** were not stated by the docs. M3 (Claude Code) and M8 (Codex) must verify them against
  **recorded real payloads**, which become the adapter contract-test fixtures.
- **Recorded (M3, 2026-10-07):** 21 Claude Code 2.1.287 payloads from real `-p` sessions (start, resume, `/compact`;
  Read, Edit, Write, Bash), paths sanitised: `packages/adapters/claude-code/test/payloads/claude-code-2.1.287.jsonl`,
  checked by `test/payloads.test.ts`. Findings are in sections 2, 6, 7 and 8 below.

## 1. Events Catenet uses

| Purpose | Claude Code | Codex |
|---|---|---|
| Session begins (inject repo map + policy summary) | `SessionStart` (`source`: `startup`, `resume`, `clear`, `compact`, `fork`) | `SessionStart` (`source`: `startup`, `resume`, `clear`, `compact`) |
| Prompt submitted (off-task detection input, context) | `UserPromptSubmit` | `UserPromptSubmit` |
| Gate a tool call | `PreToolUse` | `PreToolUse` |
| Record outcome, reindex, post-edit feedback | `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` | `PostToolUse` (also runs when a Bash command exits non-zero) |
| Compaction (re-inject context after) | `PreCompact` / `PostCompact` (`manual`, `auto`) | `PreCompact` / `PostCompact` (`manual`, `auto`) |
| Turn ends | `Stop` | `Stop` |
| Session ends | `SessionEnd` (`reason`: `clear`, `resume`, `logout`, `prompt_input_exit`, `other`) | `SessionEnd` (main thread only; `reason` currently always `other`) |

`PermissionDenied` (Claude Code; per the docs it carries `tool_name`, `tool_input` and `tool_use_id`) marks the call `denied`.
`PostToolUseFailure` and `PermissionDenied` were not hit in the recorded sessions; their adapter tests use the documented
shapes.

Both agents have more events (Claude Code: `PermissionRequest`, `PostToolBatch`, `SubagentStart/Stop`, `FileChanged`, ...;
Codex: `PermissionRequest`, `SubagentStart/Stop`, `Interrupt`). Catenet does not use them in v1.

## 2. Common input fields (stdin JSON for command hooks)

**Claude Code** (verbatim example; for `http` hooks the same JSON is the POST body):
```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "scratchpad_dir": "/tmp/claude-1000/-home-user-my-project/abc123/scratchpad",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite",
    "timeout": 120000,
    "run_in_background": false
  },
  "tool_use_id": "toolu_01ABC123..."
}
```
- `permission_mode`: `default | plan | acceptEdits | auto | dontAsk | bypassPermissions` ("not all events receive this field").
- `agent_id` / `agent_type` only inside a subagent or with `--agent`. `prompt_id` absent until the first user input.
- `transcript_path` is written asynchronously and may lag.
- **Observed in 2.1.287** (recorded payloads): every event carried `session_id`, `transcript_path`, `cwd`,
  `scratchpad_dir`, `hook_event_name`. `prompt_id` was absent on `SessionStart` with `source` `startup` or `resume`.
  `permission_mode` was absent on `SessionStart`, `PreCompact` and `SessionEnd`. Undocumented extras: `model` appeared
  only on `SessionStart` with `source: "compact"` (so `sessions.model` is usually empty); `context_tokens`,
  `seconds_since_last_response`, `prompt_cache_likely_expired` and `estimated_cache_write_usd` only on
  `source: "resume"`; tool events have `effort`; `PostToolUse` has `duration_ms`; `Stop` has
  `last_assistant_message`, `background_tasks`, `session_crons`. The adapter reads only documented fields plus `model`
  and `duration_ms`, both optional.
- **`PostToolUse.tool_response` can hold file contents**: for `Edit` it includes `originalFile`, `oldString`,
  `newString` and `structuredPatch`; for `Write`, `content` and `originalFile`; for `Read`, the file. Catenet's hook
  client drops `tool_response` before sending the payload to the daemon, so it is never stored (ARCHITECTURE 2.4).

**Codex**:
- `session_id` ("Subagent hooks use the parent session id"), `transcript_path` (string or null; format "isn't a stable
  interface"), `cwd`, `hook_event_name`, `model` (Codex extension), `turn_id` on turn-scoped events, `permission_mode`
  (`default | acceptEdits | plan | dontAsk | bypassPermissions`) on most events.
- Only full example in the docs (verbatim):
```json
{
  "session_id": "thr_123",
  "transcript_path": "/workspace/.codex/rollout.jsonl",
  "cwd": "/workspace",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

## 3. PreToolUse

### 3.1 Input
**Claude Code**: `tool_name`, `tool_input`, `tool_use_id`. "For the file tools `Write`, `Edit`, and `Read`,
`tool_input.file_path` is always absolute."

| Tool | `tool_input` fields |
|---|---|
| `Bash` | `command`, `description`, `timeout` (ms), `run_in_background` |
| `Write` | `file_path`, `content` |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all` |
| MCP tools | `mcp__<server>__<tool>`, arguments as `tool_input`; plus `mcp_server {name, source}` |

`MultiEdit` no longer appears in the hooks or tools reference: treat it as removed (**UNCONFIRMED**; keep the adapter
tolerant if it shows up).

**Codex**: `turn_id`, `tool_name`, `tool_use_id`, `tool_input`.

| Tool | `tool_name` | `tool_input` |
|---|---|---|
| Shell / unified exec | `Bash` | `{ "command": "<string>" }` |
| File edits | `apply_patch` (matchers `Edit` and `Write` also match it; input still says `apply_patch`) | `{ "command": "<patch text>" }` |
| MCP tools | `mcp__<server>__<tool>` | tool arguments |

- **Target paths for Codex edits require parsing the patch text.** The patch grammar is **UNCONFIRMED** (not documented
  on the pages fetched). Hosted tools (e.g. web search) do not fire hooks.
- Codex warns: "Treat tool hooks as a useful guardrail, not a complete enforcement boundary."

### 3.2 Output

**Claude Code** (verbatim shape):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "My reason here",
    "updatedInput": { "field_to_modify": "new value" },
    "additionalContext": "Current environment: production. Proceed with caution."
  }
}
```
- `permissionDecision`: `allow | deny | ask | defer` (`defer` only in `-p`). Across several hooks: `deny > defer > ask > allow`.
  "Deny and ask rules are still evaluated regardless of what the hook returns."
- `permissionDecisionReason`: shown to the **user** for `ask`, to **Claude** for `deny`, debug log only for `allow`/`defer`.
- `additionalContext`: added alongside the tool result. Capped at 10,000 characters (longer is saved to a file and previewed).
- Top-level `decision: approve | block` is **deprecated** for PreToolUse (maps to `allow` / `deny`).
- A `deny` blocks even in `bypassPermissions` mode. PreToolUse fires before any permission-mode check, in every mode.

**Codex** (verbatim):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by hook."
  }
}
```
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "The pending command touches generated files."
  }
}
```
- Legacy `{ "decision": "block", "reason": "..." }` is also accepted as deny.
- **No working `ask`**: "`permissionDecision: "ask"`, legacy `decision: "approve"`, `continue: false`, `stopReason`, and
  `suppressOutput` are parsed but not supported yet. Codex marks the hook run as failed, reports the error, and continues
  the tool call."
- `updatedInput` only with `allow`; for `Bash`/`apply_patch` it must contain a string `command`.
- Context is capped at about 2,500 tokens per handler by default (`additionalContextLimit`); longer output is saved to
  `<temp_dir>/hook_outputs/<session_id>/<uuid>.txt` and previewed.
- Unsupported known fields fail the hook run (the tool proceeds). Behavior for completely unknown fields: **UNCONFIRMED**.

### 3.3 Exit codes

| Exit | Claude Code | Codex |
|---|---|---|
| 0 | Success. stdout parsed as JSON if it starts with `{` and ends with `}`; otherwise debug log (except `UserPromptSubmit`, `SessionStart`: plain stdout becomes context). stderr to debug log. | Success. Plain stdout ignored for PreToolUse; JSON parsed. |
| 2 | Blocking error: the call is denied, stderr (or JSON reason) is the reason Claude sees; even JSON `allow` can't override it. | Blocks; stderr is the reason. |
| other | Non-blocking error; the action proceeds (if valid JSON was printed, the JSON alone decides). | Hook run fails; tool proceeds. |
| timeout / can't start | **Does not block** the tool call (fail-open). | Hook fails without blocking. |

## 4. PostToolUse

**Claude Code** input (verbatim):
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.txt", "content": "file content" },
  "tool_response": { "filePath": "/path/to/file.txt", "type": "create" },
  "tool_use_id": "toolu_01ABC123...",
  "duration_ms": 12
}
```
`tool_response` shape varies by tool (Bash: `stdout`, `stderr`, `interrupted`, `isImage`). Failed calls go to
`PostToolUseFailure` instead.

Feedback to the model (Catenet's post-edit violation feedback):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "This file is generated. Edit src/schema.ts and run `bun generate` instead."
  }
}
```
Also `decision: "block"` + `reason` ("adds the `reason` next to the tool result. Claude still sees the original output"),
or exit 2 (stderr shown to Claude; the tool already ran).

**Codex** input: `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response`. Output (verbatim):
```json
{
  "decision": "block",
  "reason": "The Bash output needs review before continuing.",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "The command updated generated files."
  }
}
```
- `additionalContext` is added as developer context (non-destructive). Catenet uses this.
- `decision: "block"` **replaces** the tool result with the feedback. Catenet should not use it for advisory feedback.

## 5. SessionStart and UserPromptSubmit context injection

Both agents accept plain stdout or JSON `additionalContext` as context. Claude Code (verbatim):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Current branch: feat/auth-refactor\nUncommitted changes: src/auth.ts, src/login.tsx\nActive issue: #4211 Migrate to OAuth2",
    "sessionTitle": "auth-refactor"
  }
}
```
- Claude Code `UserPromptSubmit` input adds `prompt`; it can block (`decision: "block"`) but "can't replace the prompt".
- Codex `UserPromptSubmit` input adds `prompt` and `turn_id`; plain stdout or `additionalContext` becomes developer context.
  After compaction, Codex runs `SessionStart` hooks matching `source: "compact"` before the next model request.

## 6. Configuration

**Claude Code** (`settings.json` or a plugin's `hooks/hooks.json`): `hooks` → event → `[{ matcher, hooks: [handler] }]`.
- Matcher: `"*"`, `""` or omitted = all; only letters/digits/`_-,| ` = exact name or list (`Edit|Write`); else JS regex.
- Handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent` (experimental). **`SessionStart` supports only `command`
  and `mcp_tool`.**
- `timeout` in seconds. Default 600 for `command`/`http`/`mcp_tool`; 30 on `UserPromptSubmit`. SessionEnd hooks share a
  1.5 s budget by default.
- "All matching hooks run in parallel."
- `http` handler (verbatim):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:8080/hooks/pre-tool-use",
            "timeout": 30,
            "headers": { "Authorization": "Bearer $MY_TOKEN" },
            "allowedEnvVars": ["MY_TOKEN"]
          }
        ]
      }
    ]
  }
}
```
  "HTTP hooks can't signal a blocking error through status codes alone": return 2xx + JSON decision. Non-2xx or a
  connection failure is a non-blocking error (fail-open). Admins can restrict URLs with `allowedHttpHookUrls`.
- **Why Catenet doesn't use `http` hooks (ADR-0015):** variables are expanded in `headers` (via `allowedEnvVars`) but
  not in `url`, and Catenet's daemons are per repository, so one static plugin config can't reach the right daemon.
- **`async: true`** (command hooks; verified 2026-10-07): the hook gets the full stdin payload but Claude Code doesn't
  wait for it, and its output can't affect the session. In `-p` mode, async hooks still running when the session ends
  are cancelled. Catenet makes every recording-only hook async.
- **Exec form** (`"command": "node", "args": [...]`) expands `${CLAUDE_PLUGIN_ROOT}` in `args`. `CLAUDE_PROJECT_DIR` is
  exported to hook commands and to MCP servers.

**Codex** (`~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`, or a
plugin's `hooks/hooks.json`; all layers run, none replace each other):
```toml
[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = '/usr/bin/python3 "$(git rev-parse --show-toplevel)/.codex/hooks/pre_tool_use_policy.py"'
timeout = 30
statusMessage = "Checking Bash command"
```
- Handler types: `command`, `mcp_tool` (`prompt`/`agent` parsed but skipped). **No `http` type.**
- `timeout` in seconds; default 600 (SessionEnd/Interrupt: 1 s, max 3 s). Matcher is a regex.
- **Trust**: project-local hooks load only when the project `.codex/` layer is trusted, and trust is recorded against the
  hook's hash: new or changed hooks are skipped until reviewed with `/hooks`. Plugin hooks are not auto-trusted.
- Matching command hooks for one event run concurrently.

## 7. Headless / non-interactive behavior

- **Claude Code `-p`**: with no permission host (no `--permission-prompt-tool`, no SDK `canUseTool`), a call that would
  prompt is **denied**, not hung; Claude reads `permissionDecisionReason` in the tool result. With a host, the run waits
  for the host. In auto mode, a hook `ask` forces a prompt (the classifier can deny but not silently approve).
- Hook `ask` under `dontAsk`, `bypassPermissions` and `acceptEdits`: **UNCONFIRMED** (M3 never emits `ask`; check in M5).
- **Observed (M3):** in `-p`, `PostCompact` (async) was never recorded: the session ended before it ran and it was
  cancelled. Synchronous hooks (`SessionStart`, `PreToolUse`, `Stop`, `SessionEnd`) all ran.
- **Codex `codex exec`**: no hook can ask (see 3.2). Actions needing new approval fail in non-interactive flows.
- **Security note (Claude Code)**: in `-p`/SDK sessions the workspace-trust dialog is skipped, so hooks committed in a
  repository's `.claude/settings.json` run in folders never trusted. Catenet must never rely on repo-committed hooks for
  safety of an untrusted repo.

## 8. Session identity

- Claude Code: `--resume`/`--continue` keep the session id; `--fork-session` creates a new one. `/clear` fires `SessionEnd`
  (`clear`) then `SessionStart` (`clear`).
  - **Confirmed (M3 recordings, 2.1.287):** `--resume` keeps the id (`SessionStart` with `source: "resume"`), and so does
    `/compact` (`PreCompact` `trigger: "manual"`, then `SessionStart` `source: "compact"`, same id). In `-p`, each run
    ended with `SessionEnd` `reason: "other"`, including runs later resumed.
  - Whether the id changes on `/clear`: **UNCONFIRMED** (`/clear` isn't available in `-p`; check interactively).
- Codex: example ids look like thread ids (`thr_...`); subagent hooks carry the parent session id. Persistence across
  compaction/resume: **UNCONFIRMED** (implied).
- Catenet therefore keys sessions on `(agent, session_id)` and records `SessionStart.source`, rather than assuming either.

## 9. Packaging and guidance files

- **Claude Code plugin**: plugin root holds `hooks/hooks.json`, `.mcp.json`, `skills/<name>/SKILL.md` (preferred over
  `commands/`), optional `.claude-plugin/plugin.json`. Paths via `${CLAUDE_PLUGIN_ROOT}` (changes on update; don't store
  state there); persistent data in `${CLAUDE_PLUGIN_DATA}`. Install: `/plugin marketplace add owner/repo`, then
  `/plugin install <name>@<marketplace>` (or `claude plugin install ... --scope project`).
  - **Observed in 2.1.287 (M4 pilot):**
    - **Names:** a plugin's MCP server is named `plugin:<plugin>:<server>`, and its tools
      `mcp__plugin_<plugin>_<server>__<tool>` (Catenet's: `mcp__plugin_catenet_catenet__impact_of`). A server added with
      `claude mcp add catenet` gets `mcp__catenet__impact_of` instead, so Catenet's injected text names tools without a
      prefix.
    - **`--strict-mcp-config`** drops a `--plugin-dir` plugin's MCP server too, while the plugin's hooks still run.
    - **Built-in plugins:** `system/init` lists them (`cc-plugin-agents-md@builtin`, `cc-plugin-plugin-authoring@builtin`)
      in every session.
    - **Inherited environment:** a `claude -p` started from inside another Claude Code session inherits that session's
      environment (`CLAUDECODE`, `CLAUDE_EFFORT`, `CLAUDE_CODE_ENTRYPOINT`, `MCP_CONNECTION_NONBLOCKING`, ...), which
      changes its behaviour.
- **Codex MCP**: `codex mcp add <name> -- <command>` or `[mcp_servers.<name>] command = "...", args = [...]` in
  `config.toml` (`startup_timeout_sec` default 10, `tool_timeout_sec` default 60).
- **CLAUDE.md imports**: `@path/to/file` (relative to the importing file, max depth 4). **Claude Code reads `AGENTS.md`
  natively** (v2.1.277+) only when no `CLAUDE.md` exists in the directory chain, unless configured to load both;
  `@AGENTS.md` inside CLAUDE.md still works and is never read twice.
- **Codex AGENTS.md**: global `~/.codex/AGENTS.override.md` or `AGENTS.md`, then one file per directory from the project
  root down to cwd (`AGENTS.override.md`, `AGENTS.md`, then fallback names), concatenated root-first; limit
  `project_doc_max_bytes` (32 KiB default; per-file vs combined is **UNCONFIRMED**, the docs disagree).

## 10. Mapping Catenet decisions to agent responses (ADR-0003)

| `on_match` (strongest wins) | Verdict | Claude Code `PreToolUse` | Codex `PreToolUse` |
|---|---|---|---|
| nothing matched / `record_only` | `allow` | no output, exit 0 | no output, exit 0 |
| `tell_agent` | `allow` + context | `additionalContext` only (no `permissionDecision`, so normal permission flow applies) | `additionalContext` only |
| `ask_human` | `ask` | `permissionDecision: "ask"` + reason; **denied in `-p` without a host** | **No equivalent. Open decision for M8** (options: deny with "needs human approval" reason, or downgrade to `tell_agent`) |
| `block` | `deny` | `permissionDecision: "deny"` + reason | `permissionDecision: "deny"` + reason |

Rules that follow from the docs:
- Never emit an explicit `permissionDecision: "allow"` for `record_only`/`tell_agent`: it would skip the user's own
  permission prompts. Catenet only ever adds restrictions.
- Injected context must fit both caps: **at most ~2,000 tokens per injection** (below Codex's ~2,500-token default and
  Claude Code's 10,000-character cap).
- Fail-open is reinforced by both agents (timeouts and startup failures don't block), but adapters must still return
  quickly and never exit 2 except for an explicit `block`.
