// graph.db schema (ARCHITECTURE 2.2 + ADR-0013). Forward-only migrations keyed by meta.schema_version.

export const SCHEMA_VERSION = 1;

export const MIGRATIONS: Record<number, string> = {
  1: `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE nodes (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,   -- repo|package|file|symbol|external (spec layer adds more; validated in code)
  subkind      TEXT,            -- file: source|test; symbol: function|class|method|...; external: third_party|builtin|unresolved
  name         TEXT NOT NULL,   -- symbols: qualified name (Class.method); externals: package/module name or specifier
  path         TEXT,            -- repo-relative, for package/file/symbol
  start_line   INTEGER,
  end_line     INTEGER,
  lang         TEXT,
  content_hash TEXT,
  attrs        TEXT,            -- JSON
  updated_at   INTEGER NOT NULL
);
-- Stable identity so a reindex upserts rows and keeps incoming edges from other files (ADR-0013).
CREATE UNIQUE INDEX nodes_identity ON nodes(kind, coalesce(path, ''), name, coalesce(subkind, ''));
CREATE INDEX nodes_path ON nodes(path);
CREATE INDEX nodes_name ON nodes(name);

CREATE TABLE edges (
  src        INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst        INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,   -- contains|imports|calls|references|inherits|tests|depends_on
  confidence TEXT NOT NULL,   -- exact|heuristic
  provenance TEXT NOT NULL,   -- parser (M1); declared|tagged|inferred (spec layer)
  attrs      TEXT,
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX edges_dst ON edges(dst, kind);

-- Derived and rebuildable (ADR-0013): extracted facts, so importers can be re-resolved without re-parsing.
CREATE TABLE file_facts (
  file_id      INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  facts_json   TEXT NOT NULL
);

-- Derived and rebuildable (ADR-0013): file-level projection of imports|calls|references|inherits edges.
CREATE TABLE file_deps (
  src_file   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst_file   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  confidence TEXT NOT NULL,
  PRIMARY KEY (src_file, dst_file)
);
CREATE INDEX file_deps_dst ON file_deps(dst_file);
`,
};
