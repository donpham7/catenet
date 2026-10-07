// S4: hook transport latency. Spawns the daemon, then times each transport end to end (process spawn included).
// Run: node s4-bench.ts
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { printTable, type Summary, summarize } from "./stats.ts";

const N = 300;
const PAYLOAD = JSON.stringify({
  session_id: "abc123",
  transcript_path: "/home/user/.claude/projects/x/transcript.jsonl",
  cwd: "/home/user/my-project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  tool_input: {
    file_path: "/home/user/my-project/lib/format.ts",
    old_string: "a".repeat(200),
    new_string: "b".repeat(200),
    replace_all: false,
  },
  tool_use_id: "toolu_01ABC123",
});

function timeSpawn(
  label: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Summary {
  const times: number[] = [];
  let lastOut = "";
  for (let i = 0; i < N + 5; i++) {
    const t0 = performance.now();
    const r = spawnSync(cmd, args, { input: PAYLOAD, env, encoding: "utf8" });
    const ms = performance.now() - t0;
    if (r.status !== 0) throw new Error(`${label} exited ${r.status}: ${r.stderr}`);
    lastOut = r.stdout;
    if (i >= 5) times.push(ms);
  }
  console.error(`${label}: output ${lastOut.length} bytes`);
  return summarize(label, times);
}

async function timeHttp(label: string, port: number): Promise<Summary> {
  const times: number[] = [];
  for (let i = 0; i < N + 5; i++) {
    const t0 = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      body: PAYLOAD,
      headers: { "content-type": "application/json" },
    });
    await res.text();
    const ms = performance.now() - t0;
    if (i >= 5) times.push(ms);
  }
  return summarize(label, times);
}

mkdirSync("data/compile-cache", { recursive: true });
rmSync("data/s4.port", { force: true });
const daemon = spawn(process.execPath, ["s4-daemon.ts"], { stdio: ["ignore", "inherit", "inherit"] });
for (let i = 0; i < 50; i++) {
  try {
    readFileSync("data/s4.port");
    break;
  } catch {
    await sleep(50);
  }
}
const port = Number(readFileSync("data/s4.port", "utf8"));
const node = process.execPath;
const hasCurl = spawnSync("curl", ["--version"]).status === 0;

console.log(
  `node ${process.version}, ${process.platform}-${process.arch}, N=${N} per case (5 warmup runs discarded)\n`,
);
const rows: Summary[] = [
  timeSpawn("baseline: spawn `true` (process spawn cost only)", "true", []),
  timeSpawn("baseline: `node -e 0` (Node startup only)", node, ["-e", "0"]),
  timeSpawn("(a) command: node s4-client.mjs -> unix socket", node, ["s4-client.mjs"]),
  timeSpawn("(b) same + NODE_COMPILE_CACHE", node, ["s4-client.mjs"], {
    ...process.env,
    NODE_COMPILE_CACHE: "data/compile-cache",
  }),
];
if (hasCurl) {
  rows.push(
    timeSpawn("(c) command: curl --unix-socket", "curl", [
      "-s",
      "--max-time",
      "0.25",
      "--unix-socket",
      "data/s4.sock",
      "-X",
      "POST",
      "--data-binary",
      "@-",
      "http://catenet/hook",
    ]),
  );
}
rows.push(await timeHttp("(d) loopback HTTP POST, no spawn (≈ Claude Code `http` hook)", port));
daemon.kill();
printTable(rows);
