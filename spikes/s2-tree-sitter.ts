// S2: native tree-sitter vs web-tree-sitter (WASM) for TS, TSX, JS and Python.
// Measures grammar load, parse time on ~2k-line synthetic files plus real files, and import extraction via queries.
// Run: node s2-tree-sitter.ts
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Language, Parser, Query } from "web-tree-sitter";
import { printTable, type Summary, summarize, timeMs } from "./stats.ts";

const require = createRequire(import.meta.url);
const PARSE_RUNS = 40;
const WARMUP_RUNS = 5; // untimed, so JIT/WASM tier-up does not dominate the tail

const TS_IMPORTS = `
(import_statement source: (string) @src)
(export_statement source: (string) @src)
(call_expression function: (import) arguments: (arguments (string) @src))
(call_expression function: (identifier) @fn (#eq? @fn "require") arguments: (arguments (string) @src))
`;
const PY_IMPORTS = `
(import_statement) @imp
(import_from_statement) @imp
`;

function syntheticTs(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < 40; i++) out.push(`import { helper${i} } from "../lib/mod${i}";`);
  out.push(
    `export * from "./barrel";`,
    `const lazy = await import("./lazy");`,
    `const cjs = require("./legacy");`,
  );
  let i = 0;
  while (out.length < lines) {
    out.push(
      `export class Widget${i} extends Base${i % 7} {`,
      `  private value: number = ${i};`,
      `  render(input: Array<string>): string {`,
      `    return input.map((x) => helper${i % 40}(x) + this.value).join(",");`,
      `  }`,
      `}`,
      `export function compute${i}(a: number, b?: number): number { return a * (b ?? ${i}); }`,
    );
    i++;
  }
  return out.join("\n");
}

function syntheticPy(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < 40; i++) out.push(`from ..lib.mod${i} import helper${i}`);
  out.push("import os, sys", "from . import sibling");
  let i = 0;
  while (out.length < lines) {
    out.push(
      `class Widget${i}(Base${i % 7}):`,
      `    def render(self, items):`,
      `        return ",".join(helper${i % 40}(x) for x in items)`,
      ``,
      `def compute${i}(a, b=None):`,
      `    return a * (b if b is not None else ${i})`,
      ``,
    );
    i++;
  }
  return out.join("\n");
}

interface Input {
  name: string;
  grammar: "typescript" | "tsx" | "javascript" | "python";
  source: string;
}

const inputs: Input[] = [
  { name: "synthetic.ts (2k lines)", grammar: "typescript", source: syntheticTs(2000) },
  { name: "synthetic.tsx (2k lines)", grammar: "tsx", source: syntheticTs(2000) },
  { name: "synthetic.py (2k lines)", grammar: "python", source: syntheticPy(2000) },
];
const realTs = "../node_modules/@types/node/fs.d.ts";
const realPy = "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/argparse.py";
if (existsSync(realTs))
  inputs.push({ name: "@types/node fs.d.ts", grammar: "typescript", source: readFileSync(realTs, "utf8") });
if (existsSync(realPy))
  inputs.push({ name: "cpython argparse.py", grammar: "python", source: readFileSync(realPy, "utf8") });

const WASM: Record<Input["grammar"], string> = {
  typescript: "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "node_modules/tree-sitter-python/tree-sitter-python.wasm",
};

async function benchWasm(): Promise<Summary[]> {
  const rows: Summary[] = [];
  const initMs = performance.now();
  await Parser.init();
  const langs = {} as Record<Input["grammar"], Language>;
  for (const g of Object.keys(WASM) as Input["grammar"][]) langs[g] = await Language.load(WASM[g]);
  const loadMs = performance.now() - initMs;
  rows.push({ label: "wasm: init + load 4 grammars", n: 1, p50: loadMs, p95: loadMs, max: loadMs });
  console.error(
    `wasm ABI versions: ${Object.entries(langs)
      .map(([g, l]) => `${g}=${l.abiVersion}`)
      .join(", ")}`,
  );

  const parser = new Parser();
  for (const input of inputs) {
    const lang = langs[input.grammar];
    parser.setLanguage(lang);
    const query = new Query(lang, input.grammar === "python" ? PY_IMPORTS : TS_IMPORTS);
    const times: number[] = [];
    let imports = 0;
    for (let i = 0; i < WARMUP_RUNS + PARSE_RUNS; i++) {
      const ms = timeMs(() => {
        const tree = parser.parse(input.source);
        if (!tree) throw new Error("parse failed");
        imports = query.captures(tree.rootNode).filter((c) => c.name !== "fn").length;
        tree.delete();
      });
      if (i >= WARMUP_RUNS) times.push(ms);
    }
    query.delete();
    rows.push(summarize(`wasm: ${input.name} parse+query (${imports} imports)`, times));
  }
  parser.delete();
  return rows;
}

interface NativeParser {
  setLanguage(lang: unknown): void;
  parse(src: string): { rootNode: unknown };
}
interface NativeParserCtor {
  new (): NativeParser;
  Query: new (lang: unknown, src: string) => { captures(node: unknown): { name: string }[] };
}

function benchNative(): Summary[] {
  const rows: Summary[] = [];
  const t0 = performance.now();
  const NParser = require("tree-sitter") as NativeParserCtor;
  const tsMod = require("tree-sitter-typescript") as { typescript: unknown; tsx: unknown };
  const langs: Record<Input["grammar"], unknown> = {
    typescript: tsMod.typescript,
    tsx: tsMod.tsx,
    javascript: require("tree-sitter-javascript"),
    python: require("tree-sitter-python"),
  };
  const loadMs = performance.now() - t0;
  rows.push({ label: "native: require + load 4 grammars", n: 1, p50: loadMs, p95: loadMs, max: loadMs });

  const parser = new NParser();
  for (const input of inputs) {
    const lang = langs[input.grammar];
    parser.setLanguage(lang);
    const query = new NParser.Query(lang, input.grammar === "python" ? PY_IMPORTS : TS_IMPORTS);
    const times: number[] = [];
    let imports = 0;
    for (let i = 0; i < WARMUP_RUNS + PARSE_RUNS; i++) {
      const ms = timeMs(() => {
        const tree = parser.parse(input.source);
        imports = query.captures(tree.rootNode).filter((c) => c.name !== "fn").length;
      });
      if (i >= WARMUP_RUNS) times.push(ms);
    }
    rows.push(summarize(`native: ${input.name} parse+query (${imports} imports)`, times));
  }
  return rows;
}

console.log(`node ${process.version}, ${process.platform}-${process.arch}`);
console.log(`inputs: ${inputs.map((i) => `${i.name} = ${i.source.split("\n").length} lines`).join("; ")}\n`);
const wasmRows = await benchWasm();
let nativeRows: Summary[] = [];
try {
  nativeRows = benchNative();
} catch (err) {
  console.error(`native tree-sitter failed: ${(err as Error).message}`);
}
printTable([...wasmRows, ...nativeRows]);
