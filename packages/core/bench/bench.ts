// M1 benchmark (ROADMAP M1: single-file incremental reindex < 1 s on a 2k-file synthetic repo).
// Run: pnpm --filter @catenet/core bench   (builds first; runs against dist/)
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexRepo, openGraph } from "@catenet/core";
import { generateSyntheticRepo, TS_FILES_PER_MODULE, TS_MODULES, tsFile } from "./generate.ts";

const RUNS = 10;
const root = join(tmpdir(), "catenet-bench-synthetic");
const dbPath = join(tmpdir(), "catenet-bench.db");

function summarize(samples: number[]): { p50: number; p95: number; max: number } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? Number.NaN;
  return { p50: at(50), p95: at(95), max: s[s.length - 1] ?? Number.NaN };
}

const rows: string[] = [];
const row = (label: string, samples: number[], mode: string) => {
  const { p50, p95, max } = summarize(samples);
  rows.push(
    `| ${label} | ${mode} | ${samples.length} | ${p50.toFixed(0)} | ${p95.toFixed(0)} | ${max.toFixed(0)} |`,
  );
};

async function timed(): Promise<{ ms: number; mode: string }> {
  const t0 = performance.now();
  const stats = await indexRepo({ root, dbPath });
  return { ms: performance.now() - t0, mode: stats.mode };
}

const { files } = generateSyntheticRepo(root);
for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });

const full = await timed();
row("full index (cold, empty db)", [full.ms], full.mode);
const noop: number[] = [];
for (let i = 0; i < RUNS; i++) noop.push((await timed()).ms);
row("no change", noop, "noop");

// Edits target files spread across modules; low-numbered modules are hubs.
const targets = Array.from({ length: RUNS }, (_, i) =>
  tsFile((i * 7) % TS_MODULES, (i * 13) % TS_FILES_PER_MODULE),
);
const hubs = Array.from({ length: RUNS }, (_, i) => tsFile(i % 3, i % 5));

async function scenario(label: string, files: string[], change: (src: string) => string): Promise<void> {
  const samples: number[] = [];
  let mode = "";
  for (const rel of files) {
    const abs = join(root, rel);
    const original = readFileSync(abs, "utf8");
    writeFileSync(abs, change(original));
    const r = await timed();
    samples.push(r.ms);
    mode = r.mode;
    writeFileSync(abs, original);
    await timed();
  }
  row(label, samples, mode);
}

await scenario("body edit (no export change)", targets, (s) =>
  s.replace("return total *", "return 1 + total *"),
);
await scenario("rename an export in a hub file", hubs, (s) =>
  s.replace(/export function (fn_\d+_\d+)_2\(/, "export function $1_renamed("),
);

const addSamples: number[] = [];
const delSamples: number[] = [];
let addMode = "";
let delMode = "";
for (let i = 0; i < 3; i++) {
  const extra = join(root, `src/m00/extra${i}.ts`);
  writeFileSync(extra, 'import { fn_00_00_0 } from "./f00";\nexport const x = fn_00_00_0(1);\n');
  const a = await timed();
  addSamples.push(a.ms);
  addMode = a.mode;
  rmSync(extra);
  const d = await timed();
  delSamples.push(d.ms);
  delMode = d.mode;
}
row("add a file", addSamples, addMode);
row("delete a file", delSamples, delMode);

const graph = openGraph(dbPath);
const queries: number[] = [];
let hubDependents = 0;
for (let i = 0; i < 50; i++) {
  const t0 = performance.now();
  hubDependents = graph.dependents(tsFile(0, i % 5)).transitive.length;
  queries.push(performance.now() - t0);
}
const impacts: number[] = [];
for (let i = 0; i < 20; i++) {
  const t0 = performance.now();
  graph.impact(tsFile(0, i % 5));
  impacts.push(performance.now() - t0);
}
graph.close();
row(`dependents query, hub file (~${hubDependents} transitive)`, queries, "query");
row("impact query, hub file", impacts, "query");

const header = [
  `node ${process.version}, ${process.platform}-${process.arch}, ${files} code files, ${new Date().toISOString().slice(0, 10)}`,
  "",
  "| case | mode | n | p50 ms | p95 ms | max ms |",
  "|---|---|---|---|---|---|",
];
const report = [...header, ...rows].join("\n");
console.log(report);
if (process.env.CATENET_BENCH_OUT) appendFileSync(process.env.CATENET_BENCH_OUT, `${report}\n`);
rmSync(root, { recursive: true, force: true });
