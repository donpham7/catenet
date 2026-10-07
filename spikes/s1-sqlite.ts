// S1: better-sqlite3 vs node:sqlite on the ARCHITECTURE 2.2 schema.
// Synthetic graph: 2,000 files + 18,000 symbols (20k nodes), ~60k edges, WAL mode, file database.
// Run: node s1-sqlite.ts
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { printTable, type Summary, summarize, timeMs } from "./stats.ts";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");

const FILES = 2_000;
const SYMBOLS_PER_FILE = 9;
const IMPORTS_PER_FILE = 5;
const CALLS_PER_SYMBOL = 2;
const LOOKUPS = 2_000;
const TRAVERSALS = 300;

const SCHEMA = `
CREATE TABLE nodes (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, subkind TEXT, name TEXT NOT NULL, path TEXT,
  start_line INTEGER, end_line INTEGER, lang TEXT, content_hash TEXT, attrs TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE edges (
  src INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, confidence TEXT NOT NULL, provenance TEXT NOT NULL, attrs TEXT,
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX edges_dst ON edges(dst, kind);
CREATE INDEX nodes_path ON nodes(path);
CREATE INDEX nodes_name ON nodes(name);
`;

// Dependents of a file, all hops, cycle-safe (UNION dedupes), test files excluded by subkind.
const DEPENDENTS_SQL = `
WITH RECURSIVE dep(id) AS (
  SELECT ?
  UNION
  SELECT e.src FROM edges e JOIN dep ON e.dst = dep.id
  WHERE e.kind IN ('imports', 'calls', 'references', 'inherits')
)
SELECT count(*) AS n FROM dep JOIN nodes ON nodes.id = dep.id
WHERE nodes.kind = 'file' AND coalesce(nodes.subkind, '') <> 'test'
`;

// Deterministic PRNG so both bindings get the identical graph.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Graph {
  nodes: [number, string, string | null, string, string | null][];
  edges: [number, number, string][];
}

function makeGraph(): Graph {
  const rand = rng(42);
  const nodes: Graph["nodes"] = [];
  const edges: Graph["edges"] = [];
  const seen = new Set<string>();
  const addEdge = (src: number, dst: number, kind: string) => {
    const k = `${src}:${dst}:${kind}`;
    if (src !== dst && !seen.has(k)) {
      seen.add(k);
      edges.push([src, dst, kind]);
    }
  };
  let id = 1;
  const fileIds: number[] = [];
  const symbolIds: number[] = [];
  for (let f = 0; f < FILES; f++) {
    const fileId = id++;
    fileIds.push(fileId);
    nodes.push([fileId, "file", f % 10 === 0 ? "test" : "source", `f${f}.ts`, `src/m${f % 40}/f${f}.ts`]);
    for (let s = 0; s < SYMBOLS_PER_FILE; s++) {
      const symId = id++;
      symbolIds.push(symId);
      nodes.push([symId, "symbol", "function", `fn_${f}_${s}`, `src/m${f % 40}/f${f}.ts`]);
      addEdge(fileId, symId, "contains");
    }
  }
  // Skewed imports (square of uniform) make low-numbered files hubs, like real shared helpers.
  for (const src of fileIds) {
    for (let i = 0; i < IMPORTS_PER_FILE; i++) {
      const dst = fileIds[Math.floor(rand() ** 2 * fileIds.length)];
      if (dst !== undefined) addEdge(src, dst, "imports");
    }
  }
  for (const src of symbolIds) {
    for (let i = 0; i < CALLS_PER_SYMBOL; i++) {
      const dst = symbolIds[Math.floor(rand() ** 2 * symbolIds.length)];
      if (dst !== undefined) addEdge(src, dst, "calls");
    }
  }
  return { nodes, edges };
}

interface Db {
  exec(sql: string): void;
  run(sql: string, ...params: (string | number | null)[]): void;
  prepare(sql: string): {
    get(...params: (string | number)[]): unknown;
    run(...params: (string | number | null)[]): void;
  };
  close(): void;
}

function openBetter(path: string): Db {
  const db = new BetterSqlite3(path);
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...p) => void db.prepare(sql).run(...p),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return { get: (...p) => st.get(...p), run: (...p) => void st.run(...p) };
    },
    close: () => db.close(),
  };
}

function openNode(path: string): Db {
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...p) => void db.prepare(sql).run(...p),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return { get: (...p) => st.get(...p), run: (...p) => void st.run(...p) };
    },
    close: () => db.close(),
  };
}

function bench(label: string, open: (path: string) => Db, graph: Graph): Summary[] {
  const path = `data/s1-${label}.db`;
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
  const db = open(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const now = Date.now();
  const insertMs = timeMs(() => {
    db.exec("BEGIN");
    const insNode = db.prepare(
      "INSERT INTO nodes (id, kind, subkind, name, path, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const [id, kind, subkind, name, p] of graph.nodes) insNode.run(id, kind, subkind, name, p, now);
    const insEdge = db.prepare(
      "INSERT INTO edges (src, dst, kind, confidence, provenance) VALUES (?, ?, ?, 'exact', 'parser')",
    );
    for (const [src, dst, kind] of graph.edges) insEdge.run(src, dst, kind);
    db.exec("COMMIT");
  });

  const rand = rng(7);
  const byPath = db.prepare("SELECT id, kind, name FROM nodes WHERE path = ? AND kind = 'file'");
  const lookups: number[] = [];
  for (let i = 0; i < LOOKUPS; i++) {
    const f = Math.floor(rand() * FILES);
    lookups.push(timeMs(() => byPath.get(`src/m${f % 40}/f${f}.ts`)));
  }

  const deps = db.prepare(DEPENDENTS_SQL);
  const hubCounts: number[] = [];
  const hubTimes: number[] = [];
  const randTimes: number[] = [];
  for (let i = 0; i < TRAVERSALS; i++) {
    // File node ids are 1, 11, 21, ...; file index 0..4 are the biggest hubs.
    const hubId = 1 + (i % 5) * (SYMBOLS_PER_FILE + 1);
    hubTimes.push(
      timeMs(() => {
        const row = deps.get(hubId) as { n: number };
        hubCounts.push(row.n);
      }),
    );
    const randomId = 1 + Math.floor(rand() * FILES) * (SYMBOLS_PER_FILE + 1);
    randTimes.push(timeMs(() => deps.get(randomId)));
  }
  db.close();

  console.error(
    `${label}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, insert ${insertMs.toFixed(0)} ms, ` +
      `hub dependents ≈ ${Math.max(...hubCounts)} files`,
  );
  return [
    summarize(`${label}: point lookup by path`, lookups),
    summarize(`${label}: dependents of hub file (all hops)`, hubTimes),
    summarize(`${label}: dependents of random file (all hops)`, randTimes),
    { label: `${label}: bulk insert (one transaction)`, n: 1, p50: insertMs, p95: insertMs, max: insertMs },
  ];
}

mkdirSync("data", { recursive: true });
const graph = makeGraph();
console.log(
  `node ${process.version}, sqlite ${process.versions.sqlite}, ${process.platform}-${process.arch}\n`,
);
printTable([...bench("better-sqlite3", openBetter, graph), ...bench("node-sqlite", openNode, graph)]);
