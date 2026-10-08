// Where the harness finds its inputs. Everything lives in a Catenet checkout (the eval suite is a checked-in fixture),
// so the checkout is found by walking up from this file; the plugin bundle can't run evals.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findCheckout(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "fixtures", "eval-shop")) && existsSync(join(dir, "packages", "eval")))
      return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The Catenet checkout, or null when running from somewhere else (e.g. the plugin bundle in Claude Code's cache). */
export const CATENET_ROOT = findCheckout();

export function checkout(): string {
  if (!CATENET_ROOT)
    throw new Error("catenet eval runs from a Catenet checkout (it needs fixtures/eval-shop)");
  return CATENET_ROOT;
}

export const defaultSuiteDir = () => join(checkout(), "fixtures", "eval-shop");
export const defaultPluginDir = () => join(checkout(), "plugins", "claude-code");
export const lockFile = () => join(checkout(), "packages", "eval", "suite.lock.json");
export const resultsDir = () => join(checkout(), "packages", "eval", "results");
