#!/usr/bin/env node
// Daemon process entry: `node main.js --root <repo>`. Started by ensureDaemon (detached, output to .catenet/daemon.log).
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { AlreadyRunningError, createDaemon, DEFAULT_IDLE_MS } from "./server.js";

const { values } = parseArgs({ options: { root: { type: "string" } } });
const root = resolve(values.root ?? process.cwd());
const idleMs = Number(process.env.CATENET_DAEMON_IDLE_MS ?? DEFAULT_IDLE_MS);
const daemon = createDaemon({ root, idleMs, onStop: () => process.exit(0) });

for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void daemon.stop());

try {
  await daemon.start();
} catch (err) {
  if (err instanceof AlreadyRunningError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(0);
  }
  throw err;
}
