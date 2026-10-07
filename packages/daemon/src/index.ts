// @catenet/daemon: per-repo long-lived writer of graph.db (ADR-0014).
export { call, type HealthResponse, health } from "./client.js";
export { HookHandler, type HookRequest } from "./hooks.js";
export {
  daemonStatus,
  type EnsureResult,
  ensureDaemon,
  type IndexRequest,
  readState,
  requestIndex,
  type StopResult,
  stopDaemon,
} from "./lifecycle.js";
export {
  acceptsBuild,
  buildId,
  DAEMON_MAIN,
  type DaemonState,
  INDEX_WORKER,
  isOurDaemon,
  logFile,
  runtimeDir,
  socketPath,
  stateFile,
} from "./paths.js";
export {
  AlreadyRunningError,
  createDaemon,
  type Daemon,
  type DaemonOptions,
  DEFAULT_IDLE_MS,
} from "./server.js";
export { type RepoWatcher, watchRepo } from "./watcher.js";
