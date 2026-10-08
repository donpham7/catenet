// @catenet/core: graph store, indexer and read-only queries.

export { EXTRACTOR_VERSION } from "@catenet/parsers";
export {
  CATENET_GITIGNORE,
  type CatenetConfig,
  configPath,
  DEFAULT_CONFIG,
  findOptedInRoot,
  isOptedIn,
  isTooBroadForRoot,
  loadConfig,
  prepareStateDir,
} from "./config.js";
export { IGNORED_DIRS, isTestFile, listRepoFiles } from "./discover/files.js";
export { lineDiff } from "./events/diff.js";
export { redactSecrets, summarizeToolInput } from "./events/redact.js";
export {
  EVENTS_SCHEMA_VERSION,
  EventSchemaError,
  EventStore,
  HOOK_ERRORS_LOG,
  type SessionReport,
} from "./events/store.js";
export {
  type AgentName,
  EDIT_TOOLS,
  editTarget,
  type NeutralEvent,
  type ToolOutcome,
} from "./events/types.js";
export { canonicalPath, repoRelative } from "./fspath.js";
export {
  affectsGraph,
  defaultDbPath,
  type IndexOptions,
  type IndexStats,
  indexRepo,
  pendingChanges,
} from "./index/indexer.js";
export type { Confidence, EdgeKind, ExternalSubkind } from "./model.js";
export { editContext, sessionContext } from "./query/context.js";
export {
  type Dependent,
  type DependentsResult,
  Graph,
  type Impact,
  type ImpactSummary,
  openGraph,
  type RepoMap,
  type ResolvedTarget,
  TargetError,
} from "./query/graph.js";
export { SCHEMA_VERSION } from "./store/schema.js";
export type { EvidenceRow } from "./store/sqlite-store.js";
export { MAX_TEXT_FIELD, sanitizeDeep, sanitizeText } from "./text.js";
export { CATENET_VERSION } from "./version.js";
