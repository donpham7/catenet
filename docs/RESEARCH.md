# Research: landscape and gaps

> Compiled 2026-10-03 from web searches and README/landing-page reading. **Nothing here was installed or tested.** Marketing claims are
> self-reported. Treat as hypotheses to validate (task deferred from M0 to M4: install the closest competitors and test them on our fixtures).
> This space moves fast; re-check before making public claims.

## What already exists

### Code graphs / dependency context for agents
- **codebase-memory-mcp**: open-source MCP server that indexes a repo into a persistent local graph (functions, classes, call chains, routes,
  cross-service links); auto-installs for many agents (incl. Claude Code, Codex CLI); embedded 3D graph visualization; team-shared graph artifact.
  https://deusdata.github.io/codebase-memory-mcp/
- **codegraph** (optave/ops-codegraph-tool): dependency analysis CLI with `fn-impact`, `diff-impact`, roles (high fan-in), hotspot triage, interactive HTML
  graph; uses Claude Code hooks to inject dependency context, block commits with cycles/dead exports. https://github.com/optave/ops-codegraph-tool
- **GitLab Knowledge Graph (gkg)**-based skills for semantic code discovery and call graphs.

### Blast-radius / pre-edit or pre-commit gates
- **code-impact-mcp**: dependency graph + PASS/WARN/BLOCK pre-commit verdict. https://github.com/vk0dev/code-impact-mcp
- **agent_hub** (white-dots): static import graph exposed as MCP tools; "check blast radius before editing"; post-edit hooks. https://github.com/white-dots/agent_hub
- **rgctl**: transitive caller blast-radius scoring with policy gates for agent-driven PRs (Kubernetes example).
- **diffgate**: deterministic review gate on changed lines (MCP, editor, pre-commit, CI), can use a code graph for cross-file blast radius.
- Pattern writeups exist for a hand-rolled `PreToolUse` blast-radius gate that returns `ask`/`deny`.
- A hackathon prototype ("Blast Radius Live") shows a live graph with agents including a *Scope Guard* (edits outside the task) and Impact Analyst.

### Code-anchored memory with staleness
- **legendary-mcp**: memories anchored to file/symbol/commit, content-hashed; flagged stale when code changes, orphaned when removed; injects on file touch.
  https://pypi.org/project/legendary-mcp/
- **Archiva**: git-native decision log anchored to functions/classes/blocks; stale when fingerprints drift; drift lint. https://github.com/Jalkarna/archiva
- **yigraf**: one graph over code, intent, plan and memory; intent-to-code drift checks; push hooks for Claude Code and Codex. https://pypi.org/project/yigraf/
- Research: *EA-Graph: artifact-anchored verification memory for coding agents under upstream drift* (arXiv 2608.04278).
- Generic memory servers (reference knowledge-graph memory MCP, Mem0, Letta, agentmemory) are widespread and not code-aware.

### Memory + enforcement + audit
- **world-model-mcp**: temporal knowledge graph with PreToolUse constraint enforcement ("validate at the edit boundary"), learned constraints from corrections/PR reviews,
  contradiction resolution, post-compaction re-injection, `AGENTS.md`/`CLAUDE.md` constraint reader, optional signed audit chain, adapters for 10+ agents including
  Codex. Self-reported benchmark: +10.2 pts single-trial upper bound on a 49-instance SWE-bench subset, but multi-seed mean effect CI [0, 0.47] (touches zero).
  https://pypi.org/project/world-model-mcp/
  Also advertises generating `CLAUDE.md` from its graph.

### Observability and guardrails
- Claude Code natively emits OpenTelemetry traces/metrics/events (tool spans, permission decisions, cost).
- **Arthur Engine** integration (OpenInference traces via hooks), **Dev-Agent-Lens** (LiteLLM proxy + OTel/OpenInference), **Claude Trace Replay** (session viewer).
- **Kontext CLI**: local guardrails, risk scoring, redacted traces in SQLite, local dashboard, scoped credentials; Claude Code is the active adapter (also observes Cowork).
  https://pkg.go.dev/github.com/kontext-security/kontext-cli

### Platform capabilities (affects our design)
- **Codex CLI hooks are stable** (since v0.124, April 2026): `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `Stop`; fire for
  subagent tool calls; strict output schema; no working `ask`. https://learn.chatgpt.com/docs/hooks (moved from
  developers.openai.com/codex). Verified details: `docs/HOOK_SCHEMAS.md`.
- **Claude Code hooks**: `PreToolUse` can allow/deny/ask; `http` hook type (POST to a local URL); plugins package hooks + MCP.
  Verified details: `docs/HOOK_SCHEMAS.md`.
- **ChatGPT** supports remote MCP only (developer mode), tools only (no sampling/elicitation/resources); no hooks. **Claude.ai** supports remote custom connectors; no hooks.
  Hence chat apps are out of scope for v1.

### Spec-driven development and requirements/architecture tooling
- **GitHub Spec Kit** (agent-agnostic CLI/templates: constitution, specify, plan, tasks), **Amazon Kiro** (requirements.md in EARS, design.md, tasks.md), **OpenSpec**
  (change-management/spec-anchored, supports 20+ assistants), **BMAD-METHOD**, and many others. Comparisons describe Spec Kit's enforcement as convention-only and Kiro's as
  review-gated rather than enforced; Kiro adds formal requirements analysis. Typical overhead is hours per feature for heavyweight flows.
  https://codemyspec.com/blog/spec-driven-development , https://levelop.dev/blog/spec-driven-development-tools-compared
- **Spec/documentation drift** is a recognized failure mode; governance tools such as **SpecGov** detect when code changes without its spec, mapping `.kiro/specs`, Spec Kit, OpenSpec and ADRs.
  https://dev.to/paladini/your-specs-are-lying-how-to-detect-documentation-drift-in-every-pull-request-41p7
- Spec-to-code compilers/traceability matrices (e.g. archiet-microcodegen) exist in a different category (generation, not agent guardrails).
- Caveat from the literature: spec-heavy approaches draw comparisons to the model-driven development wave that struggled with adoption; keep our layer incremental and optional.
- **yigraf** (above) already links intent/plan to code symbols with drift checks, so intent-to-code drift alone is not novel.

## Where we think the gap is (hypotheses)
1. **Unification:** structure + guidance + event history + (later) memory behind *one* explainable policy decision. Competitors cover parts; the pieces are rarely joined.
2. **Agent-neutral observability and gating:** one neutral event schema/UI across Claude Code and Codex. Many tools are Claude-only or treat other agents as thin ports.
3. **Evidence:** reproducible, statistically honest benchmarks of gate precision, regression prevention, and token savings. Existing claims are mostly unmeasured or have weak CIs.
4. **Guidance-as-output with drift checks,** aligned to the same policy rules the gate enforces.
5. **Off-task detection** (often called task drift): thinly covered (prototype level); precision unproven.
6. **Spec-aware enforcement at agent edit time:** spec tools create specs; I did not find one that evaluates architecture rules and requirement risk at the agent's edit boundary across Claude Code and Codex, with explanations. (Hypothesis; validate.)

## Where we are NOT differentiated (don't pretend)
- Basic code graph indexing and MCP query tools (codebase-memory-mcp, codegraph).
- Anchored-memory staleness (legendary-mcp, Archiva, yigraf); this is why memory is M9, not MVP.
- Signed audit chains (world-model-mcp / Etch); backlog only if customers ask.
- Generic tracing/OTel dashboards (Arthur, Arize, native Claude Code OTel).

## Strategic risks
- Anthropic/OpenAI ship native equivalents (structure-aware gating, memory, richer telemetry).
- Incumbents add what we add (world-model-mcp iterates very fast: ~30 releases in 6 months).
- Users disable noisy gates; precision is the product.
- Static analysis misses dynamic edges; over-claiming erodes trust.

## M0/M4 validation tasks
- Install world-model-mcp, yigraf, codebase-memory-mcp, code-impact-mcp, Kontext; run each on our fixtures; record: install friction, latency, what they catch/miss vs answer keys, false positives.
- Update this file with *measured* findings and delete any hypothesis the data kills.
