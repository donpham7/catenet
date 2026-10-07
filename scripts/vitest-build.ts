// Vitest global setup: build every package once, so process-level tests (daemon, MCP over stdio, CLI) spawn the
// real dist/ binaries rather than sources (ADR-0014).
import { execFileSync } from "node:child_process";

export default function setup(): void {
  execFileSync("pnpm", ["-r", "--filter", "./packages/*", "run", "build"], { stdio: "inherit" });
}
