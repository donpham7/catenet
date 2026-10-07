#!/usr/bin/env node
// Entry: `node hook.js <agent>` with the hook payload on stdin. Always exits 0 (fail open).
import { runHook } from "./hook-client.js";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c: string) => {
  stdin += c;
});
process.stdin.on("end", () => {
  let out = "";
  void runHook(process.argv[2] ?? "claude-code", {
    stdin,
    env: process.env,
    write: (text) => {
      out += text;
    },
    startedAt: performance.timeOrigin,
  }).finally(() => {
    if (out) process.stdout.write(out, () => process.exit(0));
    else process.exit(0);
  });
});
