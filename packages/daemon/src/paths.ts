// Where a repo's daemon lives (ADR-0014). The socket is outside the repo: unix socket paths are length-limited, and
// the directory is created 0700 so only the user can connect.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATENET_VERSION } from "@catenet/core";

/**
 * Built entry points. In the plugin bundle every entry sits in one flat dist/ directory (daemon.mjs,
 * index-worker.mjs next to this code); in the workspace they are the package's own dist/ (one level above src/ and
 * dist/ alike). The bundle layout is checked first (ADR-0015).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const bundled = (name: string) => (existsSync(join(HERE, name)) ? join(HERE, name) : null);
export const DAEMON_MAIN =
  bundled("daemon.mjs") ?? fileURLToPath(new URL("../dist/main.js", import.meta.url));
export const INDEX_WORKER =
  bundled("index-worker.mjs") ?? fileURLToPath(new URL("../dist/index-worker.js", import.meta.url));

/** The daemon entry of either install: the plugin bundle's daemon.mjs or the workspace's daemon/dist/main.js. */
const DAEMON_BINARY = /[\\/](?:daemon\.mjs|daemon[\\/]dist[\\/]main\.js) --root /;

/**
 * True only if `pid` is a Catenet daemon for `root`: its command line runs our daemon binary with this root. A pid
 * from a stale daemon.json may have been reused by an unrelated process, which we must never signal (M2 review #3).
 */
export function isOurDaemon(pid: number, root: string): boolean {
  if (process.platform === "win32") return false;
  try {
    const command = execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // Either install's daemon counts (the workspace build or the plugin bundle), so one can stop the other.
    const daemonBinary = command.includes(DAEMON_MAIN) || DAEMON_BINARY.test(command);
    return daemonBinary && (command.includes(root) || command.includes(canonicalRoot(root)));
  } catch {
    return false;
  }
}

export function runtimeDir(): string {
  const dir =
    process.env.CATENET_RUNTIME_DIR ??
    (process.env.XDG_RUNTIME_DIR
      ? join(process.env.XDG_RUNTIME_DIR, "catenet")
      : join(homedir(), ".cache", "catenet", "run"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best effort: the directory may belong to a parent we can't chmod (e.g. XDG_RUNTIME_DIR is already private).
  }
  return dir;
}

export const canonicalRoot = (root: string): string => (existsSync(root) ? realpathSync(root) : root);

export function socketPath(root: string): string {
  const hash = createHash("sha256").update(canonicalRoot(root)).digest("hex").slice(0, 12);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\catenet-${hash}`
    : join(runtimeDir(), `catenet-${hash}.sock`);
}

export const stateFile = (root: string) => join(root, ".catenet", "daemon.json");
export const logFile = (root: string) => join(root, ".catenet", "daemon.log");

/**
 * Identifies the daemon build: version, install flavour (the plugin bundle or the workspace build) and the daemon
 * binary's modification time, so a rebuilt Catenet replaces a daemon still running old code.
 */
export function buildId(main = DAEMON_MAIN): string {
  const mtime = existsSync(main) ? statSync(main).mtimeMs : 0;
  const flavour = main.endsWith(".mjs") ? "plugin" : "workspace";
  // CATENET_BUILD_SALT lets tests simulate a different build without touching the shared dist/ binary.
  const salt = process.env.CATENET_BUILD_SALT ? `+${process.env.CATENET_BUILD_SALT}` : "";
  return `${CATENET_VERSION}+${flavour}+${Math.trunc(mtime)}${salt}`;
}

/**
 * Whether a client of build `mine` should use a daemon running build `running` rather than replace it. The same
 * build, or the same version from the other install (the workspace CLI and the plugin bundle serve the same API and
 * would otherwise keep replacing each other's daemon). A rebuild of the same install, or another version, replaces.
 */
export function acceptsBuild(running: string, mine: string): boolean {
  if (running === mine) return true;
  const [runVersion, runFlavour] = running.split("+");
  const [myVersion, myFlavour] = mine.split("+");
  return runVersion === myVersion && runFlavour !== myFlavour;
}

export interface DaemonState {
  pid: number;
  socket: string;
  buildId: string;
  startedAt: string;
}
