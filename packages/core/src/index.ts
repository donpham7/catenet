// @catenet/core: graph store, indexer and read-only queries.
export { isTestFile, listRepoFiles } from "./discover/files.js";
export { defaultDbPath, type IndexOptions, type IndexStats, indexRepo } from "./index/indexer.js";
export type { Confidence, EdgeKind, ExternalSubkind } from "./model.js";
export {
  type Dependent,
  type DependentsResult,
  Graph,
  type Impact,
  openGraph,
  type ResolvedTarget,
  TargetError,
} from "./query/graph.js";
export type { EvidenceRow } from "./store/sqlite-store.js";
