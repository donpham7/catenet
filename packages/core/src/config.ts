// Per-repo settings in .catenet/config.json, and the opt-in rule. Missing or malformed config means defaults (fail
// open). A repository is opted in only once `catenet init` has written .catenet/config.json (ADR-0015).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface CatenetConfig {
  inject: { sessionStart: boolean; beforeEdit: boolean };
  /** Days of event history kept in events.db. */
  retentionDays: number;
}

export const DEFAULT_CONFIG: CatenetConfig = {
  inject: { sessionStart: true, beforeEdit: true },
  retentionDays: 30,
};

export const configPath = (root: string) => join(root, ".catenet", "config.json");

export function loadConfig(root: string, path = configPath(root)): CatenetConfig {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<CatenetConfig>;
    const inject = { ...DEFAULT_CONFIG.inject, ...(raw.inject ?? {}) };
    return {
      inject: { sessionStart: inject.sessionStart !== false, beforeEdit: inject.beforeEdit !== false },
      retentionDays:
        typeof raw.retentionDays === "number" && raw.retentionDays > 0
          ? raw.retentionDays
          : DEFAULT_CONFIG.retentionDays,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Ignore everything Catenet writes, including this file; only policy.yaml (M5) is meant to be committed. */
export const CATENET_GITIGNORE = "*\n!policy.yaml\n";

/**
 * Creates a state directory for a database. When it is a `.catenet` directory, also writes its .gitignore (if
 * missing), so `git status` stays clean whichever command created it.
 */
export function prepareStateDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (basename(dir) === ".catenet" && !existsSync(ignore)) writeFileSync(ignore, CATENET_GITIGNORE);
}

/** The repository has run `catenet init`: hooks record and MCP tools answer only then. */
export function isOptedIn(root: string): boolean {
  try {
    return statSync(configPath(root)).isFile();
  } catch {
    return false;
  }
}

/** Directories too broad to be a repository: opting one in would capture every project below it. */
export function isTooBroadForRoot(dir: string, home = homedir()): boolean {
  const d = resolve(dir);
  return d === resolve(home) || d === dirname(d);
}

/**
 * The opted-in repository containing `start`: walks up to the first directory with .catenet/config.json, never
 * accepting or passing the home directory or the filesystem root. Keep in sync with the hook client's copy.
 */
export function findOptedInRoot(start: string, home = homedir()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (isTooBroadForRoot(dir, home)) return null;
    if (isOptedIn(dir)) return dir;
    dir = dirname(dir);
  }
}
