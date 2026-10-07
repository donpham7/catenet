// M3 hook latency (ROADMAP: warm hook p95 < 100 ms). Runs the built plugin exactly as Claude Code does: bundled
// daemon via `catenet init`, then `node hook.mjs claude-code` per hook, timed from spawn to exit.
// Run: pnpm build:plugin && node packages/adapters/claude-code/bench/hook-bench.ts
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSyntheticRepo, tsFile } from "../../../core/bench/generate.ts";

const PLUGIN = join(import.meta.dirname, "../../../../plugins/claude-code/dist");
const N = 50;
const root = join(tmpdir(), "catenet-hook-bench");
const runtime = join(tmpdir(), "catenet-hook-bench-run");
const env = { ...process.env, CATENET_RUNTIME_DIR: runtime };

function hook(payload: Record<string, unknown>): Promise<{ ms: number; bytes: number }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PLUGIN, "hook.mjs"), "claude-code"], { env });
    let bytes = 0;
    child.stdout.on("data", (c: Buffer) => {
      bytes += c.length;
    });
    child.on("close", () => resolve({ ms: performance.now() - t0, bytes }));
    child.stdin.end(JSON.stringify(payload));
  });
}

const pct = (s: number[], p: number) =>
  s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? Number.NaN;
const rows: string[] = [];
async function scenario(label: string, make: (i: number) => Record<string, unknown>): Promise<void> {
  await hook(make(-1)); // one untimed warm-up
  const ms: number[] = [];
  let withOutput = 0;
  for (let i = 0; i < N; i++) {
    const r = await hook(make(i));
    ms.push(r.ms);
    if (r.bytes > 0) withOutput++;
  }
  ms.sort((a, b) => a - b);
  rows.push(
    `| ${label} | ${N} | ${pct(ms, 50).toFixed(0)} | ${pct(ms, 95).toFixed(0)} | ${pct(ms, 100).toFixed(0)} | ${withOutput}/${N} |`,
  );
}

rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
const { files } = generateSyntheticRepo(root);
const init = spawnSync(process.execPath, [join(PLUGIN, "catenet.mjs"), "init", "--repo", root], {
  encoding: "utf8",
  env,
});
if (init.status !== 0) throw new Error(`init failed: ${init.stdout}${init.stderr}`);

const edit = (file: string, session: string, id: string) => ({
  session_id: session,
  cwd: root,
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  tool_use_id: id,
  tool_input: { file_path: join(root, file), old_string: "a", new_string: "b" },
});
// A fresh session per call forces the context to be computed every time (worst case; real sessions explain a file once).
await scenario("PreToolUse Edit, hub file (~1,800 dependents), context injected", (i) =>
  edit(tsFile(0, 0), `hub-${i}`, `h${i}`),
);
await scenario("PreToolUse Edit, leaf file, no context", (i) => edit(tsFile(29, 59), "leaf", `l${i}`));
await scenario("SessionStart, repo map injected", (i) => ({
  session_id: `s-${i}`,
  cwd: root,
  hook_event_name: "SessionStart",
  source: "startup",
}));
await scenario("PostToolUse (runs async in Claude Code)", (i) => ({
  ...edit(tsFile(5, 5), "post", `p${i}`),
  hook_event_name: "PostToolUse",
  tool_response: {},
}));

spawnSync(process.execPath, [join(PLUGIN, "catenet.mjs"), "daemon", "stop", "--repo", root], { env });
const report = [
  `node ${process.version}, ${process.platform}-${process.arch}, ${files} code files, ${new Date().toISOString().slice(0, 10)}`,
  "",
  "| hook | n | p50 ms | p95 ms | max ms | with output |",
  "|---|---|---|---|---|---|",
  ...rows,
].join("\n");
console.log(report);
if (process.env.CATENET_BENCH_OUT) appendFileSync(process.env.CATENET_BENCH_OUT, `${report}\n`);
rmSync(root, { recursive: true, force: true });
rmSync(runtime, { recursive: true, force: true });
