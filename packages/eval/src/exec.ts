// Child processes for the harness: never throw on a non-zero exit, always bounded by a timeout.
import { spawn } from "node:child_process";
import { dirname } from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** PATH with the running Node first, so tool shims (`#!/usr/bin/env node`) use the same Node 24. */
export function nodeEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`, ...extra };
}

/**
 * Runs a command in its own process group and, on timeout, stops the whole group (SIGTERM, then SIGKILL after 2 s):
 * killing only the direct child would leave its children running, e.g. a `node --test` worker stuck in a loop or the
 * agent's shell commands, skewing every later session's timings (M4 review).
 */
export function run(
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? nodeEnv(),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    let timedOut = false;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined)
          process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
      } catch {
        // Already gone.
      }
    };
    let hardKill: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      hardKill = setTimeout(() => killGroup("SIGKILL"), 2000);
    }, opts.timeoutMs ?? 120_000);
    const finish = (code: number) => {
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      // Whatever the outcome, nothing from this group may outlive the call.
      killGroup("SIGKILL");
      resolve({
        code,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
        timedOut,
      });
    };
    child.on("error", (e) => {
      err.push(Buffer.from(String(e)));
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");
  });
}
