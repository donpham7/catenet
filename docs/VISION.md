# Vision

## One-line pitch
**A structural safety and memory layer for coding agents.** Catenet understands your repository
as a graph, so agents waste fewer tokens finding things, break fewer things, and leave a clear
record of what they did and why, across Claude Code and Codex.

## The problem
Coding agents are powerful and increasingly autonomous, but:

1. **They navigate blind.** Agents rediscover repo structure every session by grepping and
   reading files. This burns tokens and time, and they still miss dependents that aren't textually obvious.
2. **They break things they can't see.** Editing a shared helper, a public API, or a migration
   without knowing what depends on it causes regressions that surface later.
3. **Their context is fragile.** Notes, decisions and "gotchas" vanish at `/clear` or after
   context compaction. Hand-written `AGENTS.md`/`CLAUDE.md` files go stale and nobody notices.
4. **Their actions are hard to audit.** Teams can't easily answer "what did the agent touch
   overnight, and why was that allowed?"
5. **Tooling is fragmented.** Code graphs, memory servers, blast-radius gates and trace
   dashboards exist as separate tools, usually tied to one agent. Nothing ties them into one
   model where safety decisions use structure, history and guidance together.

## The vision
A **local, agent-neutral layer** with a single source of structural truth about the repo:

- **Know:** a continuously updated graph of files, symbols, imports, calls and tests.
- **Guard:** before an agent edits something, check its blast radius and project policy; allow,
  ask a human, or deny, with an explanation grounded in the graph.
- **Remember:** (later milestone) decisions and gotchas anchored to code, flagged stale when
  the code changes.
- **Record:** a neutral event log of sessions, tool calls, diffs and decisions, regardless of agent.
- **Guide:** generate and maintain `AGENTS.md` (read natively by Codex, imported by `CLAUDE.md`)
  from the graph, and warn when it drifts from reality.
- **Show:** a read-only visual map: blast radius, live agent activity, and "why was this blocked".

The agent stays in charge of writing code. Catenet makes it better informed and more accountable.

## Who it's for
**Primary: developers and small teams using Claude Code and/or Codex on large or long-lived repos**
(monorepos, legacy code, multi-package projects) where an unseen dependency costs real time.

**Secondary:**
- Engineering/platform leads who need visibility and guardrails over agent activity.
- Teams running more than one agent who don't want per-vendor tooling and duplicated guidance files.
- Security-minded users who want deterministic, explainable controls on agent actions.

**Not targeted in v1:** hobbyists on tiny repos (little to gain), chat-app users (ChatGPT/Claude.ai have
no hooks, so enforcement and observability do not carry over), enterprises needing cloud/SSO/compliance.

## Use cases (scenarios to build and test against)

### UC1. Safe refactor of a shared helper
Dana asks Claude Code to "simplify `formatCurrency`". The agent is about to edit
`lib/format.ts`. Catenet's pre-edit gate sees 38 transitive dependents across 3 packages and only
2 are covered by tests. With the rule set to `ask_human` it pauses with: *"`formatCurrency` has 38 dependents (12 direct);
2 covered by tests; touches the published API of `@acme/ui`. Proceed?"* The agent also receives the
dependent list as context, so the edit includes updating call sites. **Value:** a regression is
prevented before it exists.

### UC2. Protected zones
The agent tries to edit `migrations/0042_add_index.sql` or `.env.production`. Policy marks these as
protected: **block** with a clear reason and the sanctioned alternative ("create a new migration").
**Value:** deterministic guardrails that don't depend on the model's judgment.

### UC3. Onboarding an agent to a big monorepo
Sam starts a session in a 2,000-file repo. Instead of 40 grep/read calls, the agent calls
`find_symbol`, `get_dependents`, `impact_of` via MCP and gets precise answers. **Value:** fewer
tokens and tool calls, faster orientation. (We must *measure* this; see the eval plan.)

### UC4. Morning-after audit
Priya's team let an agent run a long task overnight. In the morning she opens the visualization or
runs `catenet report --session last`: files touched, which were high-impact, which tool calls were
paused for approval or blocked, tests run, and diffs. **Value:** trust and accountability without reading raw transcripts.

### UC5. "Why was this allowed/blocked?"
After an incident, a lead runs `catenet why <decision-id>` and sees the exact graph facts and policy rule
behind the decision. **Value:** explainable, reviewable safety decisions; tunable policies, fewer false positives.

### UC6. One guidance file for every agent
Instead of hand-maintaining `CLAUDE.md` and `AGENTS.md`, Catenet generates a concise `AGENTS.md`
(map, hotspots, protected zones, commands, observed conventions) between marker blocks; `CLAUDE.md` imports it.
Humans add their own guidance outside the markers. **Value:** consistent guidance across agents, less setup.

### UC7. Guidance drift in CI
A PR renames the file `AGENTS.md` calls the "main entry point". `catenet guidance --check`
(pre-commit or CI) fails: *"Section `map` is stale: `src/server.ts` no longer exists."* **Value:** guidance that
doesn't silently rot.

### UC8. Switching agents mid-project
A developer who uses Claude Code on Monday and Codex on Tuesday gets the same graph, the same gate and the same
guidance in both. **Value:** no re-setup, no divergent policies.

### UC9. (Later) Memory that knows when it's wrong
The agent records "Don't call `parseDate` with null; it throws" anchored to that function. A week later the
function is rewritten; recall returns the note flagged **stale**. **Value:** memory that doesn't assert outdated facts.

### UC10. (Experimental) Off-task warning
The user asked to "fix the login bug" and the agent starts editing billing code. A low-confidence note is recorded
and, if the rule is raised, told to the agent. **Value:** early signal of off-task behavior. Capped at `tell_agent` in v1; precision is unproven.

### UC11. Architecture rules the agent actually respects
The team declares `web` must not import `db` (ADR-0007). An agent edits `src/web/orders.ts` and adds a direct DB import. Catenet flags it immediately after the edit
("adds web→db at line 14; ADR-0007 forbids it") and the agent fixes it in the same turn; with the rule set to `block`, when the proposed content can be analyzed, it is stopped before the edit lands.
**Value:** architecture stays intact without relying on the model to remember a design doc.

### UC12. Requirement-aware safety
An edit touches code that satisfies `REQ-BILL-003` (must, high risk: "issued invoices are immutable"). The gate asks, citing the requirement and the one verifying test.
**Value:** the developer approving the edit sees the requirement at edit time, not just at review time.

### UC13. "What does this requirement touch?"
Before assigning an agent a task, a lead runs `impact_of_requirement REQ-AUTH-012` and sees the components, files and tests affected, then scopes the task accordingly.
**Value:** better task scoping and review planning; also usable by the agent via MCP.

### UC14. Traceability and gaps
`catenet spec coverage` shows requirements with no code, no verifying test, or only inferred links, and a view of code serving no requirement.
**Value:** an auditable requirements-to-code-to-test trail without a separate traceability spreadsheet.

### UC15. Bringing an existing SRS/architecture into the project
A team with an SRS and ADRs runs the `/catenet-spec` command: the agent drafts components, architecture rules and requirement links from the docs and the repo, the team reviews the diff and commits.
From then on every agent session gets the relevant architecture and requirements in context, and drift between docs and code is flagged.
**Value:** existing design knowledge becomes active guardrails instead of shelfware.

## Differentiation (see docs/RESEARCH.md for detail and caveats)
Individual pieces exist: code graphs, code-anchored memory, blast-radius gates, trace dashboards, audit logs.
Our bet is **integration, neutrality and measurement**:

1. **Unified model:** gate decisions use structure + (later) memory + event history + guidance from one place.
2. **Agent-neutral:** one core, thin adapters for Claude Code and Codex, one neutral event schema.
3. **Explainable by default:** every decision is traceable to graph facts.
4. **Guidance as an output of the graph,** kept honest by drift checks, and aligned with what the gate enforces.
5. **Evidence:** a reproducible benchmark with multiple seeds and honest confidence intervals.
6. **Spec-aware enforcement (M6A/M6B):** declared architecture and requirements become queryable, agent-visible at edit time, enforceable and explainable from the same graph and policy engine (see docs/SPEC_LAYER.md).

## Non-goals
- Not a coding agent or an agent framework.
- No graph editing (UI or chat). The graph is derived and read-only. Humans edit `AGENTS.md`.
- No direct code edits from the UI. If ever added, they must go through the agent and the gate.
- No chat-app (ChatGPT/Claude.ai) plugin in v1.
- No cloud service, accounts, or telemetry in v1.
- No cross-language call-graph resolution in v1 (static, per-language, with explicit confidence).
- Not a spec-authoring framework: we ingest specs (Spec Kit, Kiro, OpenSpec, ADRs, plain Markdown/YAML), we don't replace them.

## Success metrics
| Metric | Target (initial) | How measured |
|---|---|---|
| Hook latency (warm) | p95 < 100 ms | Benchmark in CI |
| Gate precision | ≥ 80% of rule firings (`tell_agent`/`ask_human`/`block`) judged useful on fixture tasks; track false-positive rate | Eval harness + manual labeling |
| Regression prevention | Measurable reduction in broken dependents on seeded tasks vs baseline | Eval harness (paired, multiple seeds, report CIs) |
| Token/tool-call savings | Measurable reduction on structural-question tasks | Eval harness |
| Index freshness | Incremental update < 1 s for a single-file change on a 2k-file repo | Benchmark |
| Guidance drift detection | Catches 100% of seeded stale references in fixtures | Unit/e2e tests |
| Adoption signal | Installs via a single command; time-to-first-value < 10 min | Dogfooding, user tests |

## Risks (honest list)
- **Crowded space.** Many tools overlap in part. We win on integration, neutrality and evidence, not any one feature.
- **Platform risk.** Anthropic and OpenAI keep expanding native hooks, telemetry and memory.
- **Hooks see actions, not reasoning.** Safety is about actions and structure, not intent.
- **Agents don't reliably call tools.** Proactive context injection through hooks matters more than MCP availability.
- **False positives annoy users into disabling the gate.** Ship every rule at `record_only`, make every rule tunable, track precision.
- **Static analysis limits.** Dynamic dispatch, DI and reflection hide edges; surface confidence honestly.
