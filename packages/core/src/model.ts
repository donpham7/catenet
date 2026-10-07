// Shared types between discovery, resolution, the indexer and the store.
import type { FileFacts, Lang } from "@catenet/parsers";

export type Confidence = "exact" | "heuristic";
export type ExternalSubkind = "third_party" | "builtin" | "unresolved";
/** Edge kinds that make the source a dependent of the destination (ADR-0008). */
export const DEPENDENCY_KINDS = ["imports", "calls", "references", "inherits"] as const;
export type EdgeKind = (typeof DEPENDENCY_KINDS)[number] | "tests" | "depends_on" | "contains";

export type NodeKey =
  | { kind: "file"; path: string }
  | { kind: "symbol"; path: string; name: string; subkind: string }
  | { kind: "external"; subkind: ExternalSubkind; name: string };

export interface EdgeAttrs {
  lines: number[];
  /** ImportFact kinds that produced an `imports`/`tests` edge (static, reexport, dynamic, ...). */
  importKinds?: string[];
  /** Specifiers as written, for `depends_on` edges to externals. */
  specifiers?: string[];
  /** Set on `references` edges from a file that re-exports the destination symbol. */
  reexport?: boolean;
  /** Set on `references` edges that come from an import binding (the name is imported, used or not). */
  binding?: boolean;
  /** On `depends_on` edges to third-party externals: whether the enclosing package declares the dependency. */
  declared?: boolean;
}

export interface EdgeRecord {
  src: NodeKey;
  dst: NodeKey;
  kind: EdgeKind;
  confidence: Confidence;
  attrs: EdgeAttrs;
}

export interface PackageInfo {
  /** Repo-relative directory, "." for the root. */
  path: string;
  name: string;
  published: boolean;
  manifest: "package.json" | "pyproject.toml" | "setup.py";
  /** package.json content, for exports/main/types and dependency names. */
  packageJson?: Record<string, unknown>;
  /** Declared dependency names (npm package names or normalised Python distribution names). */
  dependencies: Set<string>;
}

export interface FileRecord {
  path: string;
  lang: Lang;
  hash: string;
  isTest: boolean;
  facts: FileFacts;
}
