// @catenet/core: graph store, indexer and read-only queries.

export { EXTRACTOR_VERSION } from "@catenet/parsers";
export { IGNORED_DIRS, isTestFile, listRepoFiles } from "./discover/files.js";
export {
  affectsGraph,
  defaultDbPath,
  type IndexOptions,
  type IndexStats,
  indexRepo,
  pendingChanges,
} from "./index/indexer.js";
export type { Confidence, EdgeKind, ExternalSubkind } from "./model.js";
export {
  type Dependent,
  type DependentsResult,
  Graph,
  type Impact,
  openGraph,
  type RepoMap,
  type ResolvedTarget,
  TargetError,
} from "./query/graph.js";
export { SCHEMA_VERSION } from "./store/schema.js";
export type { EvidenceRow } from "./store/sqlite-store.js";
export { MAX_TEXT_FIELD, sanitizeText } from "./text.js";
export { CATENET_VERSION } from "./version.js";
