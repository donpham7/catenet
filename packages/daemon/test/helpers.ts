import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");

/** A copy of a fixture repo plus a private runtime dir for its socket. */
export function fixtureCopy(name: string): { root: string; runtime: string; cleanup(): void } {
  const tmp = mkdtempSync(join(tmpdir(), "cnd-"));
  const root = join(tmp, "repo");
  cpSync(join(FIXTURES, name, "repo"), root, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes(".catenet"),
  });
  return {
    root,
    runtime: join(tmp, "run"),
    cleanup: () => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

export async function until<T>(probe: () => T | null | undefined | false, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = probe();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}
