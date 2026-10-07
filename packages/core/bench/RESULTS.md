# M1 benchmark results

ROADMAP M1 acceptance: **single-file incremental reindex < 1 s on a 2k-file synthetic repo.** Met: the slowest
single-file case (renaming an export in a hub file) is 426 ms at p95.

Recorded 2026-10-07 on an Apple M1 Pro, macOS 26.5.1, Node v24.21.0. Reproduce with
`pnpm --filter @catenet/core bench` (builds, then runs against `dist/`). Numbers are machine-specific.

## Repo
`bench/generate.ts` writes a deterministic repo (own `git init`, so discovery uses `git ls-files` as in real repos):
- 2,011 code files: 1,800 TS files in 30 modules plus barrels, 100 TS test files, ~80 Python files.
- Each TS file imports 4 others, skewed toward low-numbered modules so a few files become hubs. Imports mix relative
  paths, barrels and a tsconfig alias. Files also have type-only imports and cross-file class inheritance.

## Results

| case | mode | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| full index (cold, empty db) | rebuild | 1 | 1823 | 1823 | 1823 |
| no change | noop | 10 | 83 | 91 | 91 |
| body edit (no export change) | update | 10 | 216 | 230 | 230 |
| rename an export in a hub file | update | 10 | 308 | 426 | 426 |
| add a file | update | 3 | 249 | 249 | 249 |
| delete a file | update | 3 | 244 | 245 | 245 |
| dependents query, hub file (~1808 transitive) | query | 50 | 19 | 21 | 27 |
| impact query, hub file | query | 20 | 39 | 49 | 55 |

Re-run after the M1 code-review fixes. The no-change row is from the second review's fix (return before reading
stored facts); the other rows are within noise of the first run.

## Notes
- A "no change" run costs ~85 ms: it still reads and hashes every file. M2's daemon removes most of this with a file
  watcher.
- The first version rebuilt the whole graph on any added or deleted file (~1.2 s, missing the target). Adds and
  deletes are now incremental (ADR-0013), verified against full rebuilds by `test/incremental.test.ts`.
- Queries: the hub's dependents closure covers ~90% of the repo (the generator is deliberately hub-heavy), so these
  are near worst case. This also follows up spike S1: realistic traversals on `node:sqlite` stay ~20 ms.
- Not measured here: memory use, repos larger than 2k files, and Windows.
