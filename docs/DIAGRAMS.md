# Diagrams

Source files live in `docs/diagrams/*.mermaid` (the source of truth). This page embeds them so they render on GitHub.
If you change a `.mermaid` file, regenerate this page or update the matching block.

## System overview

Agents talk to thin adapters (hooks) and to the MCP server. All logic lives in one local daemon over two SQLite stores. The repository, including spec files, policy and AGENTS.md, is the only thing humans edit.

```mermaid
flowchart TB
  subgraph Agents["Coding agents"]
    CC["Claude Code"]
    CX["Codex CLI"]
  end

  subgraph Adapters["Adapters (thin, no business logic)"]
    ACC["claude-code adapter<br/>hooks + plugin"]
    ACX["codex adapter<br/>hooks config"]
  end

  MCP["MCP server<br/>read-only tools"]

  subgraph Daemon["Catenet daemon (local, long-lived)"]
    API["Local API<br/>unix socket"]
    IDX["Indexer<br/>tree-sitter + file watcher"]
    SPEC["Spec loader<br/>components, architecture rules,<br/>requirements (M6A/M6B)"]
    QE["Query engine<br/>deps, blast radius, hotspots"]
    POL["Policy engine<br/>rules, on_match, evidence"]
    REC["Event recorder"]
    GEN["Guidance generator<br/>+ drift check"]
    UIS["UI server<br/>read-only, SSE"]
  end

  subgraph Store["SQLite in .catenet/"]
    GDB[("graph.db<br/>derived, rebuildable")]
    EDB[("events.db")]
  end

  subgraph Repo["Repository (source of truth, edited in git)"]
    CODE["Source code"]
    SPECF["Spec files<br/>catenet.spec.yaml, ADRs"]
    POLF["policy.yaml"]
    AGMD["AGENTS.md<br/>human text + generated blocks"]
  end

  BROWSER["Browser<br/>blast-radius map"]

  CC -- hooks --> ACC
  CX -- hooks --> ACX
  CC -. MCP .-> MCP
  CX -. MCP .-> MCP

  ACC -- "events / decisions" --> API
  ACX -- "events / decisions" --> API
  MCP --> QE

  API --> POL
  API --> REC
  POL --> QE
  QE --> GDB
  IDX --> GDB
  SPEC --> GDB
  REC --> EDB

  CODE --> IDX
  SPECF --> SPEC
  POLF --> POL
  GEN --> QE
  GEN -- "rewrites marked blocks only" --> AGMD

  UIS --> QE
  UIS --> EDB
  BROWSER --> UIS
```

## Gated edit: sequence

What happens on one edit: lookup, policy decision, recorded evidence, then post-edit reindex and violation feedback. Any daemon failure or timeout fails open.

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent
  participant H as Hook adapter
  participant D as Daemon
  participant G as Graph (SQLite)
  participant P as Policy engine
  participant E as Event log

  A->>H: PreToolUse (Edit lib/format.ts)
  H->>D: neutral event {tool, paths, session}

  alt daemon down, slow (over time budget) or error
    D--xH: no response
    H-->>A: allow (fail-open), error logged
  else normal path
    D->>G: resolve file to node, load impact
    G-->>D: dependents, tests, component, requirements
    D->>P: evaluate matching rules
    P-->>D: verdict + evidence
    D->>E: record decision
    D-->>H: verdict + additional context
    H-->>A: allow / ask / deny + dependents and tests
  end

  opt edit proceeds (allowed or human approved)
    A->>A: apply edit
    A->>H: PostToolUse
    H->>D: diff stats
    D->>G: incremental reindex of the file
    D->>P: check architecture rule violations
    D->>E: record diff and outcome
    opt violation introduced
      D-->>H: violation evidence
      H-->>A: feedback so the agent can fix it
    end
  end
```

## Graph model

Node and edge kinds. Top: derived from code. Bottom: declared intent from spec files (M6A/M6B). Cross links connect the two.

```mermaid
flowchart LR
  subgraph Derived["Derived from code (indexer)"]
    repo["repo"]
    package["package"]
    file["file"]
    symbol["symbol"]
    testfile["file<br/>(subkind: test)"]
    testcase["symbol<br/>(subkind: test_case)"]
    external["external dependency"]
    repo -->|contains| package
    package -->|contains| file
    file -->|contains| symbol
    file -->|imports| file
    symbol -->|calls| symbol
    symbol -->|references| symbol
    symbol -->|inherits| symbol
    file -->|depends_on| external
    testfile -->|contains| testcase
    testfile -->|tests| symbol
    testfile -->|tests| file
    testcase -->|tests| symbol
  end

  subgraph Declared["Declared intent from spec files (M6A/M6B)"]
    component["component"]
    requirement["requirement"]
    arch_rule["arch_rule"]
    adr["adr"]
    component -->|component_depends_on<br/>derived rollup| component
    requirement -->|refines| requirement
    arch_rule -->|governs| component
    arch_rule -->|decided_by| adr
  end

  file -->|belongs_to| component
  symbol -->|satisfies| requirement
  file -->|satisfies| requirement
  component -->|satisfies| requirement
  testfile -->|verifies| requirement
  testcase -->|verifies| requirement
```

## Storage schema

graph.db (nodes, edges, cached metrics, schema version) and events.db (sessions, prompts, tool calls, decisions, diffs, errors, schema version).

```mermaid
erDiagram
  NODES {
    int id PK
    string kind "repo|package|file|symbol|external|component|requirement|arch_rule|adr"
    string subkind "file: source|test; symbol: function|class|method|...|test_case"
    string name
    string path
    int start_line
    int end_line
    string lang
    string content_hash
    string attrs "JSON"
    int updated_at
  }
  EDGES {
    int src FK
    int dst FK
    string kind "contains|imports|calls|references|inherits|tests|depends_on|belongs_to|component_depends_on|satisfies|verifies|governs|decided_by|refines"
    string confidence "exact|heuristic"
    string provenance "parser|declared|tagged|inferred"
    string attrs "JSON"
  }
  METRICS {
    int node_id FK
    float fan_in
    float fan_out
    string role "hub|core|leaf"
    float hotspot_score
  }
  GRAPH_META {
    int schema_version
  }
  NODES ||--o{ EDGES : "src"
  NODES ||--o{ EDGES : "dst"
  NODES ||--o| METRICS : "cached, rebuildable"

  SESSIONS {
    string id PK
    string agent "claude-code|codex"
    string agent_version
    int started_at
    int ended_at
    string cwd
    string git_head
  }
  PROMPTS {
    string id PK
    string session_id FK
    int ts
    string text_hash
    string text_preview_redacted
  }
  TOOL_CALLS {
    string id PK
    string session_id FK
    int ts
    string tool
    string target_paths "JSON"
    string args_summary "redacted"
    string outcome
    int duration_ms
  }
  DECISIONS {
    string id PK
    string session_id FK
    string tool_call_id FK "nullable (post-edit violations)"
    int ts
    string verdict "allow|ask|deny"
    string rule_ids "JSON"
    string evidence "JSON: matched rules + on_match + caps"
    int latency_ms
  }
  DIFFS {
    string id PK
    string session_id FK
    int ts
    string path
    int added
    int removed
    string content_hash_before
    string content_hash_after
  }
  ERRORS {
    int id PK
    int ts
    string subsystem
    string message
  }
  EVENTS_META {
    int schema_version
  }
  SESSIONS ||--o{ PROMPTS : has
  SESSIONS ||--o{ TOOL_CALLS : has
  SESSIONS ||--o{ DECISIONS : has
  SESSIONS ||--o{ DIFFS : has
  TOOL_CALLS ||--o| DECISIONS : "gated by"
```

## Policy decision flow

Fail-open first, then every rule's `match` is evaluated; the strongest `on_match` (after engine caps) decides what the agent sees. Every path records evidence.

```mermaid
flowchart TD
  A["Tool call event from adapter"] --> B{"Daemon reachable<br/>and within time budget?"}
  B -- no --> F["Allow and log error<br/>(fail-open)"]
  B -- yes --> C["Resolve target paths to graph nodes<br/>and compute impact"]
  C --> D["Evaluate each rule's match<br/>(paths, tools, impact, spec)"]
  D --> E{"Any rule matched?"}
  E -- no --> AL["Allow"]
  E -- yes --> CAP["Apply engine caps<br/>inferred edges: at most ask_human<br/>off-task: at most tell_agent"]
  CAP --> S{"Strongest on_match"}
  S -- record_only --> O["Allow<br/>(agent sees nothing)"]
  S -- tell_agent --> W["Allow<br/>+ explanation to agent"]
  S -- ask_human --> Q["Ask<br/>(human approves or rejects)"]
  S -- block --> X["Deny<br/>+ reason and alternative"]

  AL --> R["Record decision + evidence<br/>(catenet why shows this)"]
  O --> R
  W --> R
  Q --> R
  X --> R
```

## Intent and guidance flow

Specs and code feed one read-only graph. AGENTS.md is generated into marked blocks and drift-checked. Agent-suggested links are proposals until a human accepts them into spec files.

```mermaid
flowchart LR
  subgraph Git["Repository files (humans edit, reviewed in git)"]
    SRC["Source code"]
    SPECF["Spec files<br/>components, architecture rules,<br/>requirements, ADRs"]
    AG["AGENTS.md<br/>human text + generated blocks"]
  end

  SRC --> IDX["Indexer"]
  SPECF --> LOAD["Spec loader + import adapters"]
  IDX --> G[("Derived graph<br/>read-only")]
  LOAD --> G

  G --> GEN["Guidance generator"]
  GEN -- "rewrites marked blocks only" --> AG

  G --> CHK["Drift checks<br/>guidance and spec"]
  AG --> CHK
  SPECF --> CHK
  CHK --> OUT["CLI, CI report, UI"]

  G --> CTX["Per-file context injection<br/>architecture + requirements"]
  CTX --> AGENT["Coding agent"]

  AGENT -. "drafts via /catenet-spec" .-> PROP["Proposals<br/>.catenet/proposals/"]
  PROP -- "human reviews and accepts" --> SPECF
```

## Memory freshness states (M9)

Anchored memories become stale or orphaned when their code changes or disappears.

```mermaid
stateDiagram-v2
  [*] --> Fresh: remember(anchor)
  Fresh --> Stale: anchored code changed
  Stale --> Fresh: re-anchored after review
  Fresh --> Orphaned: file or symbol deleted
  Stale --> Orphaned: file or symbol deleted
  Fresh --> Superseded: contradicted by newer memory
  Stale --> Superseded: contradicted by newer memory
  Orphaned --> [*]
  Superseded --> [*]
  note right of Fresh
    Whitespace-only changes and moved
    symbols keep a memory fresh
    (anchor re-resolved by symbol, then hashed)
  end note
```

## Milestone dependencies

Build order. Solid = MVP path, dashed = later.

```mermaid
flowchart LR
  M0["M0<br/>spike, schemas, fixtures"] --> M1["M1<br/>code graph indexer"]
  M1 --> M2["M2<br/>MCP server + daemon"]
  M2 --> M3["M3<br/>events + Claude Code hooks<br/>(record only)"]
  M3 --> M4["M4<br/>evaluation harness"]
  M4 --> M5["M5<br/>safety gate"]
  M5 --> M6["M6<br/>guidance + drift check"]
  M5 --> M6A["M6A<br/>architecture rules"]
  M6A --> M6B["M6B<br/>requirements traceability"]
  M3 --> M7["M7<br/>visualization v1"]
  M5 --> M7
  M3 --> M8["M8<br/>Codex adapter"]
  M5 --> M8
  M2 --> M9["M9<br/>anchored memory<br/>(post-MVP)"]
  M3 --> M9

  classDef mvp fill:#e8f1ff,stroke:#2b5fb3,color:#111
  classDef later fill:#f4f4f4,stroke:#888,color:#111,stroke-dasharray: 4 3
  class M0,M1,M2,M3,M4,M5,M6,M7,M8 mvp
  class M6A,M6B,M9 later
```
