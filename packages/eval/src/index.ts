// @catenet/eval (ROADMAP M4): pre-registered tasks run with and without Catenet; paired effects with confidence
// intervals. See packages/eval/README.md for the method and its limits.
export {
  type CheckResult,
  checkEdit,
  checkQuestion,
  type EditResult,
  type QuestionResult,
} from "./checks.js";
export {
  ALLOWED_TOOLS,
  type ClaudeCodeOptions,
  claudeArgs,
  claudeEnv,
  createClaudeCodeDriver,
  parseTranscript,
} from "./drivers/claude-code.js";
export { createPatchDriver, type PatchChoice } from "./drivers/patch.js";
export type { Driver, DriverResult, RunContext } from "./drivers/types.js";
export { CATENET_ROOT, defaultPluginDir, defaultSuiteDir, lockFile, resultsDir } from "./paths.js";
export {
  buildReport,
  PRIMARY_LEVEL,
  REPORT_VERSION,
  type Report,
  type RunMeta,
  type RunRow,
  readRows,
  renderMarkdown,
  writeReport,
} from "./report.js";
export { rng, shuffle } from "./rng.js";
export { type Lock, planEval, type RunOptions, readLock, runEval, writeLock } from "./run.js";
export { type Block, CONDITIONS, type Condition, makeSchedule } from "./schedule.js";
export { asPercentChange, bootstrapEffect, type Estimate, mean } from "./stats.js";
export { type EditTask, loadSuite, type QuestionTask, type Suite, suiteHash, type Task } from "./suite.js";
export { copyHoldout, prepareWorkspace, type Workspace } from "./workspace.js";
