// SqliteGraphStore: the only module that contains SQL (ARCHITECTURE 2.2). node:sqlite per ADR-0010.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Confidence, EdgeAttrs, EdgeRecord, NodeKey } from "../model.js";
import { DEPENDENCY_KINDS } from "../model.js";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";

const DEP_KINDS_SQL = DEPENDENCY_KINDS.map((k) => `'${k}'`).join(",");

export interface NodeRow {
  id: number;
  kind: string;
  subkind: string | null;
  name: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
  lang: string | null;
  content_hash: string | null;
  attrs: string | null;
}

export interface DependentRow {
  path: string;
  confidence: Confidence;
}

export interface EvidenceRow {
  kind: string;
  fromName: string | null;
  fromKind: string;
  toName: string;
  toKind: string;
  confidence: Confidence;
  lines: number[];
}

export interface SymbolInput {
  name: string;
  subkind: string;
  startLine: number;
  endLine: number;
  attrs: Record<string, unknown>;
}

const parse = (s: string | null): Record<string, unknown> =>
  s ? (JSON.parse(s) as Record<string, unknown>) : {};

export class SqliteGraphStore {
  readonly db: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    // Wait for a concurrent writer (another index run, later the daemon) instead of failing with SQLITE_BUSY.
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private migrate(): void {
    const hasMeta = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .get();
    let version = 0;
    if (hasMeta) {
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined;
      version = row ? Number(row.value) : 0;
    }
    if (version > SCHEMA_VERSION)
      throw new Error(`graph.db schema ${version} is newer than this Catenet (${SCHEMA_VERSION})`);
    for (let v = version + 1; v <= SCHEMA_VERSION; v++) {
      const sql = MIGRATIONS[v];
      if (!sql) throw new Error(`missing migration ${v}`);
      this.transaction(() => {
        this.db.exec(sql);
        this.db
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)")
          .run(String(v));
      });
    }
  }

  transaction<T>(fn: () => T): T {
    // IMMEDIATE takes the write lock up front, so two writers queue on the busy timeout instead of deadlocking.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getMeta(key: string): string | undefined {
    return (this.stmt("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)
      ?.value;
  }

  setMeta(key: string, value: string): void {
    this.stmt("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  /** Drop all derived graph data (the graph is always rebuildable). */
  clear(): void {
    this.db.exec("DELETE FROM file_deps; DELETE FROM file_facts; DELETE FROM edges; DELETE FROM nodes;");
  }

  // ---------------------------------------------------------------- nodes

  upsertNode(n: {
    kind: string;
    subkind?: string | null;
    name: string;
    path?: string | null;
    startLine?: number | null;
    endLine?: number | null;
    lang?: string | null;
    hash?: string | null;
    attrs?: Record<string, unknown>;
  }): number {
    const row = this.stmt(
      `INSERT INTO nodes (kind, subkind, name, path, start_line, end_line, lang, content_hash, attrs, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, coalesce(path, ''), name, coalesce(subkind, '')) DO UPDATE SET
         start_line = excluded.start_line, end_line = excluded.end_line, lang = excluded.lang,
         content_hash = excluded.content_hash, attrs = excluded.attrs, updated_at = excluded.updated_at
       RETURNING id`,
    ).get(
      n.kind,
      n.subkind ?? null,
      n.name,
      n.path ?? null,
      n.startLine ?? null,
      n.endLine ?? null,
      n.lang ?? null,
      n.hash ?? null,
      n.attrs ? JSON.stringify(n.attrs) : null,
      Date.now(),
    ) as { id: number };
    return row.id;
  }

  nodeId(key: NodeKey): number | undefined {
    const row =
      key.kind === "file"
        ? this.stmt("SELECT id FROM nodes WHERE kind = 'file' AND path = ?").get(key.path)
        : key.kind === "symbol"
          ? this.stmt(
              "SELECT id FROM nodes WHERE kind = 'symbol' AND path = ? AND name = ? AND subkind = ?",
            ).get(key.path, key.name, key.subkind)
          : this.stmt("SELECT id FROM nodes WHERE kind = 'external' AND subkind = ? AND name = ?").get(
              key.subkind,
              key.name,
            );
    return (row as { id: number } | undefined)?.id;
  }

  fileNode(path: string): NodeRow | undefined {
    return this.stmt("SELECT * FROM nodes WHERE kind = 'file' AND path = ?").get(path) as NodeRow | undefined;
  }

  symbolsOf(path: string): NodeRow[] {
    return this.stmt("SELECT * FROM nodes WHERE kind = 'symbol' AND path = ? ORDER BY start_line, name").all(
      path,
    ) as unknown as NodeRow[];
  }

  findSymbols(name: string): NodeRow[] {
    // Case-sensitive: exact qualified name, or a `.name` suffix (a method). LIKE would ignore ASCII case.
    const suffix = `.${name}`;
    return this.stmt(
      `SELECT * FROM nodes WHERE kind = 'symbol' AND (name = ? OR substr(name, -length(?)) = ?) ORDER BY path, name`,
    ).all(name, suffix, suffix) as unknown as NodeRow[];
  }

  filesWithParseErrors(): string[] {
    return (
      this.stmt(
        "SELECT path FROM nodes WHERE kind = 'file' AND coalesce(json_extract(attrs, '$.parseErrors'), 0) > 0 ORDER BY path",
      ).all() as { path: string }[]
    ).map((r) => r.path);
  }

  allFilePaths(): string[] {
    return (
      this.stmt("SELECT path FROM nodes WHERE kind = 'file' ORDER BY path").all() as { path: string }[]
    ).map((r) => r.path);
  }

  /** Upsert a file's symbols, delete the ones that vanished, and rewrite its file -> symbol `contains` edges. */
  syncSymbols(fileId: number, path: string, symbols: SymbolInput[]): void {
    const keep = new Set<number>();
    for (const s of symbols) {
      keep.add(
        this.upsertNode({
          kind: "symbol",
          subkind: s.subkind,
          name: s.name,
          path,
          startLine: s.startLine,
          endLine: s.endLine,
          attrs: s.attrs,
        }),
      );
    }
    for (const row of this.symbolsOf(path)) {
      if (!keep.has(row.id)) this.stmt("DELETE FROM nodes WHERE id = ?").run(row.id);
    }
    this.stmt("DELETE FROM edges WHERE src = ? AND kind = 'contains'").run(fileId);
    for (const id of [...keep].sort((a, b) => a - b)) {
      this.stmt(
        "INSERT INTO edges (src, dst, kind, confidence, provenance) VALUES (?, ?, 'contains', 'exact', 'parser')",
      ).run(fileId, id);
    }
  }

  deleteFile(path: string): void {
    this.stmt("DELETE FROM nodes WHERE path = ? AND kind IN ('file', 'symbol')").run(path);
  }

  setContains(srcId: number, dstId: number): void {
    this.stmt(
      "INSERT OR IGNORE INTO edges (src, dst, kind, confidence, provenance) VALUES (?, ?, 'contains', 'exact', 'parser')",
    ).run(srcId, dstId);
  }

  deleteOrphanExternals(): void {
    this.db.exec("DELETE FROM nodes WHERE kind = 'external' AND id NOT IN (SELECT dst FROM edges)");
  }

  // ---------------------------------------------------------------- facts

  putFacts(fileId: number, hash: string, factsJson: string): void {
    this.stmt("INSERT OR REPLACE INTO file_facts (file_id, content_hash, facts_json) VALUES (?, ?, ?)").run(
      fileId,
      hash,
      factsJson,
    );
  }

  loadFacts(): Map<string, { hash: string; factsJson: string }> {
    const rows = this.stmt(
      "SELECT n.path AS path, f.content_hash AS hash, f.facts_json AS factsJson FROM file_facts f JOIN nodes n ON n.id = f.file_id",
    ).all() as { path: string; hash: string; factsJson: string }[];
    return new Map(rows.map((r) => [r.path, { hash: r.hash, factsJson: r.factsJson }]));
  }

  // ---------------------------------------------------------------- edges

  /** Replace every non-`contains` edge whose source is the file or one of its symbols. Duplicates are merged. */
  replaceOutgoing(path: string, edges: EdgeRecord[], ensureExternal: (key: NodeKey) => number): void {
    this.stmt(
      "DELETE FROM edges WHERE kind <> 'contains' AND src IN (SELECT id FROM nodes WHERE path = ? AND kind IN ('file', 'symbol'))",
    ).run(path);
    const merged = new Map<
      string,
      { src: number; dst: number; kind: string; confidence: Confidence; attrs: EdgeAttrs }
    >();
    for (const e of edges) {
      const src = this.nodeId(e.src);
      const dst = e.dst.kind === "external" ? ensureExternal(e.dst) : this.nodeId(e.dst);
      if (src === undefined || dst === undefined || src === dst) continue;
      const k = `${src}|${dst}|${e.kind}`;
      const prev = merged.get(k);
      if (!prev) {
        merged.set(k, {
          src,
          dst,
          kind: e.kind,
          confidence: e.confidence,
          attrs: { ...e.attrs, lines: [...e.attrs.lines] },
        });
        continue;
      }
      if (e.confidence === "exact") prev.confidence = "exact";
      prev.attrs.lines = [...new Set([...prev.attrs.lines, ...e.attrs.lines])];
      for (const field of ["importKinds", "specifiers"] as const) {
        const values = e.attrs[field];
        if (values) prev.attrs[field] = [...new Set([...(prev.attrs[field] ?? []), ...values])];
      }
      if (e.attrs.reexport) prev.attrs.reexport = true;
      if (e.attrs.binding) prev.attrs.binding = true;
    }
    const insert = this.stmt(
      "INSERT INTO edges (src, dst, kind, confidence, provenance, attrs) VALUES (?, ?, ?, ?, 'parser', ?)",
    );
    for (const e of merged.values()) {
      e.attrs.lines.sort((a, b) => a - b);
      e.attrs.importKinds?.sort();
      e.attrs.specifiers?.sort();
      insert.run(e.src, e.dst, e.kind, e.confidence, JSON.stringify(e.attrs));
    }
  }

  /** Recompute the file-level dependency rows for one source file from its edges. */
  recomputeFileDeps(path: string): void {
    const file = this.fileNode(path);
    if (!file) return;
    this.stmt("DELETE FROM file_deps WHERE src_file = ?").run(file.id);
    this.stmt(
      `INSERT INTO file_deps (src_file, dst_file, confidence)
       SELECT ?, df.id, CASE WHEN SUM(e.confidence = 'exact') > 0 THEN 'exact' ELSE 'heuristic' END
       FROM edges e
       JOIN nodes s ON s.id = e.src
       JOIN nodes d ON d.id = e.dst
       JOIN nodes df ON df.kind = 'file' AND df.path = d.path
       WHERE s.path = ? AND s.kind IN ('file', 'symbol') AND d.kind IN ('file', 'symbol')
         AND e.kind IN (${DEP_KINDS_SQL}) AND d.path <> ?
       GROUP BY df.id`,
    ).run(file.id, path, path);
  }

  /** Files with any non-`contains` edge into the file or its symbols (importers, callers, tests). */
  importersOf(path: string): string[] {
    return (
      this.stmt(
        `SELECT DISTINCT s.path AS path FROM edges e
         JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst
         WHERE d.path = ? AND d.kind IN ('file', 'symbol') AND s.kind IN ('file', 'symbol') AND e.kind <> 'contains' AND s.path <> ?`,
      ).all(path, path) as { path: string }[]
    ).map((r) => r.path);
  }

  // ---------------------------------------------------------------- attributes

  /** Set `published_api` on every file and symbol: true for the given ids, false for all others. */
  setPublished(ids: Set<number>): void {
    // Write only rows whose value changes (or was never set, e.g. a row just re-upserted with fresh attrs).
    const rows = this.stmt(
      "SELECT id, json_extract(attrs, '$.published_api') AS p FROM nodes WHERE kind IN ('file', 'symbol')",
    ).all() as { id: number; p: number | null }[];
    const setTo = (value: boolean) =>
      this.stmt(
        `UPDATE nodes SET attrs = json_set(coalesce(attrs, '{}'), '$.published_api', json('${value}')) WHERE id = ?`,
      );
    for (const r of rows) {
      const want = ids.has(r.id);
      const have = r.p === 1 ? true : r.p === 0 ? false : null;
      if (have !== want) setTo(want).run(r.id);
    }
  }

  // ---------------------------------------------------------------- queries

  directDependents(targetIds: number[], excludePath: string): DependentRow[] {
    if (targetIds.length === 0) return [];
    const marks = targetIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT sf.path AS path, CASE WHEN SUM(e.confidence = 'exact') > 0 THEN 'exact' ELSE 'heuristic' END AS confidence
         FROM edges e
         JOIN nodes s ON s.id = e.src
         JOIN nodes sf ON sf.kind = 'file' AND sf.path = s.path
         WHERE e.dst IN (${marks}) AND e.kind IN (${DEP_KINDS_SQL}) AND s.kind IN ('file', 'symbol') AND s.path <> ?
         GROUP BY sf.path ORDER BY sf.path`,
      )
      .all(...targetIds, excludePath) as unknown as DependentRow[];
  }

  reverseFileDeps(path: string): DependentRow[] {
    return this.stmt(
      `SELECT s.path AS path, fd.confidence AS confidence FROM file_deps fd
       JOIN nodes s ON s.id = fd.src_file JOIN nodes d ON d.id = fd.dst_file WHERE d.path = ?`,
    ).all(path) as unknown as DependentRow[];
  }

  forwardFileDeps(path: string): DependentRow[] {
    return this.stmt(
      `SELECT d.path AS path, fd.confidence AS confidence FROM file_deps fd
       JOIN nodes s ON s.id = fd.src_file JOIN nodes d ON d.id = fd.dst_file WHERE s.path = ?`,
    ).all(path) as unknown as DependentRow[];
  }

  /** Files reached by edges leaving the given source nodes (a symbol's own dependencies). */
  directDependencies(srcIds: number[], excludePath: string): DependentRow[] {
    if (srcIds.length === 0) return [];
    const marks = srcIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT d.path AS path, CASE WHEN SUM(e.confidence = 'exact') > 0 THEN 'exact' ELSE 'heuristic' END AS confidence
         FROM edges e JOIN nodes d ON d.id = e.dst
         WHERE e.src IN (${marks}) AND e.kind IN (${DEP_KINDS_SQL}) AND d.kind IN ('file', 'symbol') AND d.path <> ?
         GROUP BY d.path ORDER BY d.path`,
      )
      .all(...srcIds, excludePath) as unknown as DependentRow[];
  }

  /** Node ids that some test file reaches with a `tests` edge. */
  testedNodeIds(): Set<number> {
    return new Set(
      (this.stmt("SELECT DISTINCT dst FROM edges WHERE kind = 'tests'").all() as { dst: number }[]).map(
        (r) => r.dst,
      ),
    );
  }

  /** Repo-relative paths whose file node or symbols are reached by a `tests` edge. */
  testedPaths(): Set<string> {
    return new Set(
      (
        this.stmt(
          "SELECT DISTINCT d.path AS path FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.kind = 'tests' AND d.kind IN ('file', 'symbol')",
        ).all() as { path: string }[]
      ).map((r) => r.path),
    );
  }

  evidence(targetIds: number[], fromPath: string): EvidenceRow[] {
    if (targetIds.length === 0) return [];
    const marks = targetIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT e.kind AS kind, s.kind AS fromKind, CASE WHEN s.kind = 'symbol' THEN s.name END AS fromName,
                d.kind AS toKind, d.name AS toName, e.confidence AS confidence, e.attrs AS attrs
         FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst
         WHERE e.dst IN (${marks}) AND e.kind IN (${DEP_KINDS_SQL}) AND s.path = ?
         ORDER BY e.kind, d.name`,
      )
      .all(...targetIds, fromPath) as {
      kind: string;
      fromKind: string;
      fromName: string | null;
      toKind: string;
      toName: string;
      confidence: Confidence;
      attrs: string | null;
    }[];
    return rows.map((r) => ({ ...r, lines: (parse(r.attrs).lines as number[] | undefined) ?? [] }));
  }

  /** Test files with a `tests` edge into any of the target nodes. */
  testsFor(targetIds: number[]): string[] {
    if (targetIds.length === 0) return [];
    const marks = targetIds.map(() => "?").join(",");
    return (
      this.db
        .prepare(
          `SELECT DISTINCT s.path AS path FROM edges e JOIN nodes s ON s.id = e.src
           WHERE e.kind = 'tests' AND e.dst IN (${marks}) ORDER BY s.path`,
        )
        .all(...targetIds) as { path: string }[]
    ).map((r) => r.path);
  }

  /** Files with the most direct dependent files. */
  hubs(limit: number): { file: string; directDependents: number }[] {
    return this.stmt(
      `SELECT d.path AS file, COUNT(*) AS directDependents FROM file_deps fd JOIN nodes d ON d.id = fd.dst_file
       GROUP BY fd.dst_file ORDER BY directDependents DESC, d.path LIMIT ?`,
    ).all(limit) as { file: string; directDependents: number }[];
  }

  packageFileCounts(): Map<number, number> {
    const rows = this.stmt(
      `SELECT e.src AS pkg, COUNT(*) AS n FROM edges e JOIN nodes p ON p.id = e.src JOIN nodes f ON f.id = e.dst
       WHERE e.kind = 'contains' AND p.kind = 'package' AND f.kind = 'file' GROUP BY e.src`,
    ).all() as { pkg: number; n: number }[];
    return new Map(rows.map((r) => [r.pkg, r.n]));
  }

  counts(): { files: number; testFiles: number; symbols: number; externals: Record<string, number> } {
    const one = (sql: string) => (this.stmt(sql).get() as { n: number }).n;
    const externals = Object.fromEntries(
      (
        this.stmt(
          "SELECT subkind, COUNT(*) AS n FROM nodes WHERE kind = 'external' GROUP BY subkind ORDER BY subkind",
        ).all() as {
          subkind: string;
          n: number;
        }[]
      ).map((r) => [r.subkind, r.n]),
    );
    return {
      files: one("SELECT COUNT(*) AS n FROM nodes WHERE kind = 'file'"),
      testFiles: one("SELECT COUNT(*) AS n FROM nodes WHERE kind = 'file' AND subkind = 'test'"),
      symbols: one("SELECT COUNT(*) AS n FROM nodes WHERE kind = 'symbol'"),
      externals,
    };
  }

  packages(): { id: number; path: string; name: string; published: boolean }[] {
    return (
      this.stmt("SELECT id, path, name, attrs FROM nodes WHERE kind = 'package' ORDER BY path").all() as {
        id: number;
        path: string;
        name: string;
        attrs: string | null;
      }[]
    ).map((r) => ({ id: r.id, path: r.path, name: r.name, published: parse(r.attrs).published === true }));
  }

  packageOfFile(path: string): string | undefined {
    const row = this.stmt(
      `SELECT p.path AS path FROM edges e JOIN nodes p ON p.id = e.src JOIN nodes f ON f.id = e.dst
       WHERE e.kind = 'contains' AND p.kind = 'package' AND f.kind = 'file' AND f.path = ?`,
    ).get(path) as { path: string } | undefined;
    return row?.path;
  }

  /** Every depends_on edge from a file to an external, one row per specifier as written. */
  externals(): { from: string; specifier: string; subkind: string; lines: number[] }[] {
    const rows = this.stmt(
      `SELECT s.path AS path, d.subkind AS subkind, e.attrs AS attrs FROM edges e
       JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst
       WHERE e.kind = 'depends_on' AND s.kind = 'file' AND d.kind = 'external' ORDER BY s.path`,
    ).all() as { path: string; subkind: string; attrs: string | null }[];
    return rows.flatMap((r) => {
      const a = parse(r.attrs);
      const lines = (a.lines as number[] | undefined) ?? [];
      return ((a.specifiers as string[] | undefined) ?? []).map((specifier) => ({
        from: r.path,
        specifier,
        subkind: r.subkind,
        lines,
      }));
    });
  }

  /** Full deterministic dump of the derived graph, keyed by node identity (for incremental-vs-full tests). */
  dump(): { nodes: string[]; edges: string[]; fileDeps: string[] } {
    const key = (r: { kind: string; path: string | null; name: string; subkind: string | null }) =>
      `${r.kind}:${r.path ?? ""}:${r.name}:${r.subkind ?? ""}`;
    const nodes = (this.db.prepare("SELECT * FROM nodes").all() as unknown as NodeRow[]).map((r) =>
      JSON.stringify([key(r), r.start_line, r.end_line, r.lang, r.content_hash, sortKeys(parse(r.attrs))]),
    );
    const edges = (
      this.db
        .prepare(
          `SELECT s.kind AS sk, s.path AS sp, s.name AS sn, s.subkind AS ss, d.kind AS dk, d.path AS dp, d.name AS dn, d.subkind AS ds,
                  e.kind AS kind, e.confidence AS confidence, e.attrs AS attrs
           FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst`,
        )
        .all() as Record<string, string | null>[]
    ).map((r) =>
      JSON.stringify([
        key({ kind: r.sk as string, path: r.sp ?? null, name: r.sn as string, subkind: r.ss ?? null }),
        key({ kind: r.dk as string, path: r.dp ?? null, name: r.dn as string, subkind: r.ds ?? null }),
        r.kind,
        r.confidence,
        sortKeys(parse(r.attrs ?? null)),
      ]),
    );
    const fileDeps = (
      this.db
        .prepare(
          "SELECT s.path AS s, d.path AS d, fd.confidence AS c FROM file_deps fd JOIN nodes s ON s.id = fd.src_file JOIN nodes d ON d.id = fd.dst_file",
        )
        .all() as { s: string; d: string; c: string }[]
    ).map((r) => `${r.s} -> ${r.d} ${r.c}`);
    return { nodes: nodes.sort(), edges: edges.sort(), fileDeps: fileDeps.sort() };
  }
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
}
