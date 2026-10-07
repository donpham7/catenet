// Vitest global setup: build every package once, so process-level tests (daemon, MCP over stdio, CLI) spawn the
// real dist/ binaries rather than sources (ADR-0014).
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Where tests build the plugin bundle. Not plugins/claude-code/dist: a plugin installed from this checkout runs from
 * there, and every test run would replace it (and restart its daemon) under a live session.
 */
export const TEST_PLUGIN_DIST = join(import.meta.dirname, "../node_modules/.cache/catenet/plugin-test/dist");

export default function setup(): void {
  execFileSync("pnpm", ["-r", "--filter", "./packages/**", "run", "build"], { stdio: "inherit" });
  // The plugin-bundle tests run the bundled entry points from a copied plugin directory.
  execFileSync("pnpm", ["build:plugin", "--out", TEST_PLUGIN_DIST], { stdio: "inherit" });
}
