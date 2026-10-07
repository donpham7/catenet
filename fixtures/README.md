# Fixtures

Small checked-in repositories with **seeded hidden dependencies** and a hand-written **answer key** of true
dependents. They are the ground truth for indexer tests (M1), the gate (M5) and the benchmark harness (M4).

```
fixtures/<name>/repo/             the repository Catenet indexes (never executed, never built)
fixtures/<name>/answer-key.json   expected results; lives outside repo/ so it is never indexed
```

| Fixture | What it seeds |
|---|---|
| `ts-basic` | One published TS package: barrel `export *`, renamed re-export, tsconfig path alias, default / namespace / type-only imports, literal and template dynamic `import()`, cross-file inheritance, an import cycle, a side-effect import, CommonJS `require`, test files importing through the barrel, a third-party import. |
| `py-basic` | One published Python project: package `__init__` re-exports, relative (`.`/`..`) and absolute imports, `import x.y as m` attribute access, `from x import *` with `__all__`, import inside `try/except`, `importlib.import_module` with a literal (heuristic) and an f-string (unresolved), inheritance, `tests/test_*.py`. |
| `monorepo-mixed` | pnpm workspace with two published packages (`@acme/utils`, `@acme/ui`), a private app (`web`) importing them by workspace name, a Python service with `pyproject.toml`, an unused export, an internal file, and protected-path candidates (`migrations/`, `.env.example`, `generated/`). |

## Counting rules (ADR-0002, ADR-0008)

- **Dependents are files.** A file is a dependent of a target when it reaches it by reverse traversal over
  `imports | calls | references | inherits`. Test files are never dependents.
- **Direct = 1 hop**, after resolving uses through re-exports: a file that calls `formatCurrency` imported from a
  barrel is a *direct* dependent of the file that defines it (and also depends on the barrel). Files that re-export a
  symbol (barrels, `__init__.py`) are dependents of it.
- **Transitive = all hops**, cycle-safe. The target is never its own dependent. `transitive` includes `direct`.
- **Edges point to the module named in the import.** Implicit Python parent-package execution (importing `a.b.c` also
  runs `a/__init__.py` and `a/b/__init__.py`) is *not* an edge.
- **Confidence:** `heuristic` if the best path to the target crosses a heuristic edge (e.g. `importlib` with a
  literal), otherwise `exact`.
- **Covered** (static coverage) lists the dependents that have an incoming `tests` edge (some test file imports or
  references them). `target_covered` says whether the target itself has one.
- **`published_api`**: the target is exported from the entry point of a published package (ADR-0008).
- **Externals:** `third_party` (declared dependency), `builtin` (language standard library or runtime built-ins, e.g.
  `importlib`, `node:fs`), `unresolved` (local-looking or dynamic specifier that cannot be resolved).

## Answer-key schema

```jsonc
{
  "fixture": "ts-basic",
  "definitions": "docs/DECISIONS.md ADR-0002, ADR-0008",
  "packages": [{ "path": ".", "name": "ts-basic-lib", "published": true }],
  "externals": [{ "from": "src/vendor.ts", "specifier": "lodash", "subkind": "third_party" }],
  "protected_path_candidates": [],
  "targets": [
    {
      "target": "src/lib/format.ts",            // a file, or "file#symbol"
      "published_api": true,
      "target_covered": true,
      "direct": [{ "file": "src/ui/widget.ts", "confidence": "exact", "via": "why this edge exists" }],
      "transitive": [{ "file": "src/ui/widget.ts", "confidence": "exact" }],
      "covered": ["src/ui/widget.ts"],
      "notes": "what this target exercises"
    }
  ]
}
```

All paths are relative to `repo/`. `packages/core/test/fixtures.test.ts` checks every answer key for internal
consistency (paths exist, `direct` is a subset of `transitive`, no test files among dependents, symbols exist in their
files, specifiers appear in their source files). It does not check the answers against an indexer; M1 does that.

## Changing a fixture
Edit `repo/`, then update `answer-key.json` by hand, re-deriving every edge you touched. Keep fixtures small enough
to verify by reading.
