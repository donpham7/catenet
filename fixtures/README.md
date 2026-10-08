# Fixtures

Small checked-in repositories with **seeded hidden dependencies** and a hand-written **answer key** of true
dependents. They are the ground truth for indexer tests (M1), the gate (M5) and the benchmark harness (M4).

```
fixtures/<name>/repo/             the repository Catenet indexes (never executed or built in place)
fixtures/<name>/answer-key.json   expected results; lives outside repo/ so it is never indexed
fixtures/eval-shop/tasks/<id>/    M4 eval tasks: task.json, prompt.md, held-out tests, patches (outside repo/)
```

The M1 fixtures are never executed. `eval-shop` is the M4 eval repository: it is runnable (`npm test` runs on Node 24
with no installs, `npm run typecheck` uses the workspace's `tsc`), but only ever in temporary copies made by
`packages/eval`. Nothing in `eval-shop/repo/` names what was seeded, because an agent reads it.

| Fixture | What it seeds |
|---|---|
| `ts-basic` | One published TS package: barrel `export *`, renamed re-export, tsconfig path alias, default / namespace / type-only imports, literal and template dynamic `import()`, cross-file inheritance, an import cycle, a side-effect import, CommonJS `require` and exports (`exports.x =`, `module.exports.x =`, `module.exports = function`/`{ ... }`, a required module called as its default export), test files importing through the barrel, a third-party import. |
| `py-basic` | One published Python project: package `__init__` re-exports, relative (`.`/`..`) and absolute imports, `import x.y as m` attribute access, `from x import *` with `__all__`, import inside `try/except`, `importlib.import_module` with a literal (heuristic) and an f-string (unresolved), inheritance, `tests/test_*.py`. |
| `eval-shop` | One published, runnable TS package (~360 files, ~300 of them noise modules and look-alike names) for the M4 eval: an `export *` barrel with two levels of renamed re-exports (`price`, then `displayPrice`), CommonJS consumers that `require()` TypeScript (invisible to the type checker), literal dynamic `import()`s, truthiness callers of a boolean, a dependent reached through the package entry, and a template `import()` that no static graph can follow (the `none`-edge control). Each task in `tasks/` lists the dependents a change must keep working, with held-out tests, a correct patch and a patch that misses dependents. |
| `monorepo-mixed` | pnpm workspace with two published packages (`@acme/utils`, `@acme/ui`), a private app (`web`) importing them by workspace name, a Python service with `pyproject.toml`, an unused export, an internal file, and protected-path candidates (`migrations/`, `.env.example`, `generated/`). |

## Counting rules (ADR-0002, ADR-0008)

- **Dependents are files.** A file is a dependent of a target when it reaches it by reverse traversal over
  `imports | calls | references | inherits`. Test files are never dependents.
- **Direct = 1 hop**, after resolving uses through re-exports: a file that calls `formatCurrency` imported from a
  barrel is a *direct* dependent of the file that defines it (and also depends on the barrel). Files that re-export a
  symbol (barrels, `__init__.py`) are dependents of it, including through `export *` chains (`src/index.ts` re-exports
  `round` from `lib/math.ts` via `export * from "./lib"`, so it is a direct dependent of `math.ts`).
- **Transitive = all hops**, cycle-safe. The target is never its own dependent. `transitive` includes `direct`.
- **Edges point to the module named in the import.** Implicit Python parent-package execution (importing `a.b.c` also
  runs `a/__init__.py` and `a/b/__init__.py`) is *not* an edge.
- **Confidence:** `heuristic` if the best path to the target crosses a heuristic edge (e.g. `importlib` with a
  literal), otherwise `exact`.
- **Covered** (static coverage) lists the dependents that have an incoming `tests` edge (some test file imports or
  references them). `target_covered` says whether the target itself has one.
- **`published_api`**: the target is exported from the entry point of a published package (ADR-0008).
- **Externals** are listed by specifier as written, minus surrounding quotes/backticks and any Python string prefix
  (`./${name}`, `pybasic.plugins.{name}`). Subkinds: `third_party` (declared dependency), `builtin` (language standard library or runtime built-ins, e.g.
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
