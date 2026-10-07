# Spec layer: architecture and requirements in the graph

> Status: design proposal. Built in milestones **M6A** (architecture) and **M6B** (requirements). Do not build before M5.
> Keep graph node/edge kinds extensible from M1 so this layer slots in without a schema rewrite.

## 1. Purpose
Some users already know their architecture and requirements (an SRS, design doc, ADRs, or a Spec Kit / Kiro / OpenSpec spec).
Today that knowledge lives in documents agents may or may not read, and it silently drifts from the code. This layer lets the
user **declare** that intent in repo files, and has Catenet:

1. **Bake it into the graph** as first-class nodes linked to code and tests.
2. **Use it** to give agents the right constraints at edit time, and to explain gate decisions in terms of requirements and architecture.
3. **Enforce architecture rules** deterministically (e.g. "web must not import db").
4. **Trace and audit:** which requirements have code and tests, which code serves no requirement, what a requirement change would affect.
5. **Detect drift** between declared intent and the code.

## 2. How this fits the "read-only graph" principle
The graph is still never edited. Declared intent is **an input stored in git files, like code**. The indexer reads code *and* spec files and
derives the graph from both. Humans (or an agent, with human review) edit the spec files. The UI and MCP tools never write graph data.
A rescan rebuilds everything.

```
code files ─┐
            ├──► indexer ──► graph (derived, read-only)
spec files ─┘               ▲
(declared intent, in git)   └─ provenance on every spec-derived node/edge:
                               declared | tagged | inferred
```
`proposed` links (e.g. LLM- or heuristic-suggested mappings) live in `.catenet/proposals/` and are **not in the graph** until a human accepts them
into the spec files.

## 3. What gets modeled

**Node kinds (additions):** `component`, `requirement`, `arch_rule` (architecture rule; ADR-0004), `adr` (architecture decision record; ADR-0001), optionally `acceptance` (criterion under a requirement).

**Edge kinds (additions):**
| Edge | Meaning | Source of truth |
|---|---|---|
| `belongs_to` | file/symbol → component | component path globs (declared) |
| `component_depends_on` | component → component | derived rollup of file imports |
| `satisfies` | file/symbol/component → requirement | declared mapping, code tag, or inferred (lower confidence) |
| `verifies` | test file/test case → requirement | explicit `verified_by`, test-name/ID convention, or tag |
| `governs` | arch_rule → component | declared |
| `decided_by` | arch_rule/component/requirement → adr | declared |
| `refines` | requirement → requirement | declared (parent/child) |

Every spec-derived edge has `provenance` ∈ {`declared`, `tagged`, `inferred`} and `confidence`. Explanations must show provenance; inferred edges
never drive `block`.

## 4. Declaring intent

### 4.1 Native minimal format (recommended default)
One or more YAML files (e.g. `catenet.spec.yaml` or `docs/spec/*.yaml`), schema-validated:

```yaml
components:
  - id: billing
    name: Billing
    paths: ["src/billing/**"]
    owner: payments-team
    description: Invoicing and payment orchestration.
  - id: web
    paths: ["src/web/**"]
  - id: db
    paths: ["src/db/**"]

arch_rules:
  - id: no-web-to-db
    kind: forbid_dependency          # forbid_dependency | allow_only | entrypoint_only | no_cycles | forbid_external
    from: web
    to: db
    on_match: block                  # record_only | tell_agent | ask_human | block (default record_only)
    ci: fail                         # fail | report (default report)
    rationale: "Web goes through the service layer. See ADR-0007."
    decided_by: ADR-0007
  - id: billing-public-api
    kind: entrypoint_only
    component: billing
    entrypoints: ["src/billing/index.ts"]

requirements:
  - id: REQ-BILL-003
    title: Issued invoices are immutable
    type: functional                 # functional | security | performance | compliance | ...
    priority: must                   # must | should | could
    risk: high                       # raises gate weight when touched
    statement: "WHEN an invoice is issued THE SYSTEM SHALL reject modification of its line items."
    components: [billing]
    verified_by: ["tests/billing/invoice_immutable.test.ts"]
    parent: REQ-BILL-001
```

Optional code-side tags (comments): `// @req REQ-BILL-003` on symbols/tests. Test names containing a requirement ID also count (as `tagged`).

### 4.2 Existing formats via adapters (don't force a new format)
Spec-driven tools already produce specs (GitHub Spec Kit, Kiro's requirements/design/tasks with EARS criteria, OpenSpec, BMAD, ADR/MADR markdown).
**Catenet is not another spec framework.** Provide import adapters that parse requirement IDs, titles, statements, acceptance criteria and ADR status
from these layouts into the same node kinds. First adapter: whichever the owner uses (decide in M6B); always include **plain Markdown with
`### REQ-XXX Title` headings** and **ADR markdown**. Verify each tool's current file layout from its docs before writing the adapter.

### 4.3 Authoring help (agent-assisted, human-reviewed)
- `catenet spec init`: scaffold files; with `--from-repo` detect likely components from directory structure, workspaces and import clusters.
- A Claude Code **slash command/skill** (`/catenet-spec`): the agent reads the repo and the user's description of architecture/requirements, drafts the YAML, and shows a diff. Writes
  go to **spec files in git**, never to the graph.
- `catenet spec suggest-links`: heuristic proposals (requirement ↔ code/tests) written to `.catenet/proposals/`; `catenet spec accept <id>` applies them to the spec files.
- `catenet spec check`: schema validation, unique IDs, globs match files, every file is in some component (or explicitly unowned), referenced tests exist. CI-friendly.

## 5. What Catenet does with it

### 5.1 Context injection for agents (the daily value)
At `SessionStart`: a compact architecture summary (components, key architecture rules, top "must" requirements), within a token budget.
At `PreToolUse` on an edit: attach **only what's relevant to that file**:
```
Catenet context: src/billing/invoice.ts
- Component: billing (owner: payments-team)
- Architecture rules: billing-public-api (only import via src/billing/index.ts); no-web-to-db
- Satisfies: REQ-BILL-003 (must, risk: high): "Issued invoices are immutable"
- Verified by: tests/billing/invoice_immutable.test.ts
```
All spec text is untrusted-ish data: quote it, cap lengths, strip control characters (same hygiene as guidance generation).

### 5.2 Architecture rule enforcement
Architecture rules are evaluated deterministically on the graph (`violations()` returns the offending edges as evidence).
- **Post-edit (always):** after an edit, reindex the file; if it introduced a violation, feed it back to the agent immediately
  ("this edit adds web→db via `src/web/x.ts:14`; ADR-0007 forbids it") and record it in the event log.
- **Pre-edit (when feasible):** for `Write`/`Edit`, parse imports in the *proposed* content and apply the rule's `on_match` before the violating edit lands.
  Where the proposed content can't be reliably determined, fall back to post-edit detection. Never claim pre-edit coverage that isn't real.
- **CI:** `catenet spec check --rules` fails the build on violations of architecture rules with `ci: fail`.
- At edit time an architecture rule is a policy rule like any other: its `on_match` decides what happens (default `record_only`). `inferred` edges never cause `block` (capped at `ask_human`).

### 5.3 Requirement-aware risk and explanations
- Editing code that `satisfies` a `risk: high` or `priority: must` requirement raises the gate's score (new weight `w7`) and adds the requirement to the evidence:
  *"Touches REQ-BILL-003 (must, high risk); 1 of 2 verifying tests would exercise this file."*
- `catenet why` and the UI "why" panel show requirement and architecture-rule evidence alongside dependents.

### 5.4 Traceability and coverage (new queries/tools)
- `trace(requirement)`: forward trace to components, files, symbols, tests.
- `requirements_for(node)`: backward trace from code.
- `coverage()`: requirements with no code, no verifying test, or only `inferred` links; code in no component; "orphan" code satisfying no requirement (advisory only, since much code legitimately serves none).
- `impact_of_requirement_change(req)`: what code and tests are affected if this requirement changes. Great for planning and for scoping an agent task.
- MCP tools (read-only): `get_component`, `get_requirements_for`, `trace_requirement`, `spec_coverage`, `spec_violations`, `impact_of_requirement`.

### 5.5 Spec drift detection
- Spec references something that no longer exists (path, test, symbol): **stale**.
- Requirement with `verified_by` test that no longer touches its code: **weakly verified**.
- Code in a `satisfies` relationship changed but spec/ADR not touched in the same PR: **advisory** drift notice (optional, off by default; avoid noise).
- ADR superseded but architecture rules still cite it: **stale rationale**.
- Output in `catenet spec check`, `catenet guidance --check`, and the UI.

### 5.6 Guidance integration
Generated `AGENTS.md` gains `architecture` (components + key architecture rules) and `requirements` (top "must" items with IDs) sections inside marker blocks, token-budgeted,
with the same drift check. Humans keep hand-written sections outside markers.

### 5.7 Visualization
Additional overlay/view (after M7): component-level map (nodes = components, edges = rolled-up dependencies, violations highlighted), and a requirement
trace view (requirement → components → files → tests, with provenance styling and gaps in red). Read-only.

## 6. Progressive adoption (avoid spec-heavy rigidity)
| Level | User provides | Catenet gives |
|---|---|---|
| L0 | nothing | graph, gate, events, guidance |
| L1 | components + a few architecture rules | architecture violations, per-file context, component map |
| L2 | requirement IDs + test links | traceability, coverage, requirement-aware risk |
| L3 | `on_match: ask_human|block` or `ci: fail` on chosen architecture rules | gating/CI enforcement with explanations |

Each level is useful alone. Every rule starts at `record_only`.

## 7. Competitive context (see RESEARCH.md)
Spec-driven tools (Spec Kit, Kiro, OpenSpec, BMAD) help create and manage specs; comparisons describe Spec Kit's enforcement as convention-only and Kiro's as
review-gated rather than enforced. Documentation-drift checkers (e.g. SpecGov) exist. yigraf links intent/plan to code symbols with drift detection.
Our angle is **not authoring specs**; it is making declared intent *queryable, agent-visible at edit time, enforceable, and explainable* from the same graph and policy engine,
across Claude Code and Codex, and measuring whether it helps.

## 8. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Specs rot; stale architecture rules mislead agents | Drift checks everywhere; stale items are flagged and excluded from injection |
| Heavy process, low adoption (cf. model-driven development) | Progressive levels; value at L1 with ~20 lines of YAML; adapters for existing docs |
| Wrong inferred mappings | Provenance on every edge; inferred never blocks; proposals require human acceptance |
| Prompt injection via spec text | Treat as data: quote, cap, strip; agent edits to spec files are matched by the `self-protection` rule |
| Agent edits the spec to make a violation disappear | Built-in `self-protection` rule matches agent edits to spec/policy files; raise it to `ask_human` |
| False-positive architecture violations (dynamic imports, barrel files) | Resolve through re-exports; mark heuristic; start at `record_only`; measure precision |

## 9. Non-goals
- Not a spec authoring workflow or IDE (use Spec Kit / Kiro / OpenSpec for that; we ingest their output).
- No requirement quality analysis or formal verification (contradiction/SMT-style checking is out of scope).
- No automatic trust in LLM-suggested mappings.
- No graph editing in UI/chat; edits happen in spec files via git.
- No code generation from specs.

## 10. Evaluation additions (M4 harness)
- Fixtures with seeded architecture violations and a requirements set with an answer key of true `satisfies`/`verifies` links.
- Metrics: violation detection precision/recall; post-edit feedback → agent fixes the violation (rate); traceability accuracy vs answer key; token cost of injected spec context;
  effect of spec-aware context on violation rate versus no spec context (paired, multiple seeds, report CIs).

## 11. Open questions
1. Native YAML only at first, or YAML + one adapter? (Recommendation: native + plain-Markdown requirements + ADR; add the owner's spec-tool adapter next.)
2. Requirement ID convention and where specs live (`docs/spec/`, repo root, or per package)?
3. Pre-edit import analysis for `Edit` (partial string replacement) is hard; accept post-edit detection as the guaranteed path in v1?
4. Should `satisfies` default to component-level (cheap, coarse) with symbol-level only where tagged?
5. How much spec text to inject per edit (default cap ~300 tokens)?
