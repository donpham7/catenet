// Deterministic synthetic repo for the M1 benchmark: ~2,000 code files.
// TS: 30 modules x 60 files + barrels, imports skewed toward low-numbered modules (hubs), mixing relative,
// barrel and tsconfig-alias imports, type-only imports and cross-file inheritance; 100 test files.
// Python: one project with 6 subpackages x 12 modules, relative imports and __init__ re-exports.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TS_MODULES = 30;
export const TS_FILES_PER_MODULE = 60;
const TS_TESTS = 100;
const PY_SUBPACKAGES = 6;
const PY_MODULES = 12;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const tsFile = (m: number, f: number) => `src/m${pad(m)}/f${pad(f)}.ts`;

export function generateSyntheticRepo(root: string): { files: number } {
  rmSync(root, { recursive: true, force: true });
  const rand = rng(1234);
  const pick = (n: number) => Math.floor(rand() ** 2 * n);
  const files = new Map<string, string>();

  files.set(
    "package.json",
    `${JSON.stringify({ name: "synthetic", version: "1.0.0", exports: { ".": "./src/index.ts" } }, null, 2)}\n`,
  );
  files.set(
    "tsconfig.json",
    `${JSON.stringify({ compilerOptions: { strict: true, paths: { "@/*": ["./src/*"] } } }, null, 2)}\n`,
  );

  for (let m = 0; m < TS_MODULES; m++) {
    const barrel: string[] = [];
    for (let f = 0; f < TS_FILES_PER_MODULE; f++) {
      const lines: string[] = [];
      const calls: string[] = [];
      let base: string | null = null;
      for (let i = 0; i < 4; i++) {
        const tm = Math.min(pick(TS_MODULES), m);
        const tf = pick(TS_FILES_PER_MODULE);
        if (tm === m && tf >= f) continue; // only import "earlier" files: keeps the graph realistic and mostly acyclic
        const fn = `fn_${pad(tm)}_${pad(tf)}_${i % 3}`;
        const alias = `${fn}_${i}`;
        const style = i % 3;
        if (style === 0) {
          const rel = tm === m ? `./f${pad(tf)}` : `../m${pad(tm)}/f${pad(tf)}`;
          lines.push(`import { ${fn} as ${alias} } from "${rel}";`);
        } else if (style === 1) {
          lines.push(`import { ${fn} as ${alias} } from "${tm === m ? "." : `../m${pad(tm)}`}";`);
        } else lines.push(`import { ${fn} as ${alias} } from "@/m${pad(tm)}/f${pad(tf)}";`);
        calls.push(`${alias}(n)`);
        if (!base && i === 0) {
          base = `C_${pad(tm)}_${pad(tf)}`;
          lines.push(
            `import { ${base} } from "${tm === m ? `./f${pad(tf)}` : `../m${pad(tm)}/f${pad(tf)}`}";`,
          );
        }
      }
      lines.push(`import type { Shape } from "../shared/types";`, "");
      for (let k = 0; k < 3; k++) {
        lines.push(
          `export function fn_${pad(m)}_${pad(f)}_${k}(n: number): number {`,
          `  const total = ${calls.length > 0 ? calls.join(" + ") : "n"};`,
          `  return total * ${k + 1};`,
          "}",
          "",
        );
      }
      lines.push(
        `export class C_${pad(m)}_${pad(f)}${base ? ` extends ${base}` : ""} {`,
        "  shape: Shape = { w: 1, h: 1 };",
        `  area(): number {`,
        "    return this.shape.w * this.shape.h;",
        "  }",
        "}",
      );
      files.set(tsFile(m, f), `${lines.join("\n")}\n`);
      barrel.push(`export * from "./f${pad(f)}";`);
    }
    files.set(`src/m${pad(m)}/index.ts`, `${barrel.join("\n")}\n`);
  }
  files.set("src/shared/types.ts", "export interface Shape {\n  w: number;\n  h: number;\n}\n");
  files.set(
    "src/index.ts",
    `${Array.from({ length: 5 }, (_, m) => `export * from "./m${pad(m)}";`).join("\n")}\n`,
  );
  for (let t = 0; t < TS_TESTS; t++) {
    const m = pick(TS_MODULES);
    const f = pick(TS_FILES_PER_MODULE);
    files.set(
      `test/t${String(t).padStart(3, "0")}.test.ts`,
      `import { fn_${pad(m)}_${pad(f)}_0 } from "../src/m${pad(m)}";\n\nexport const ok = fn_${pad(m)}_${pad(f)}_0(1) > 0;\n`,
    );
  }

  files.set("py/pyproject.toml", '[project]\nname = "synth"\nversion = "1.0.0"\n');
  files.set("py/synth/__init__.py", 'from .p0.mod00 import run_0\n\n__all__ = ["run_0"]\n');
  for (let p = 0; p < PY_SUBPACKAGES; p++) {
    const reexports: string[] = [];
    for (let i = 0; i < PY_MODULES; i++) {
      const lines: string[] = [];
      if (i > 0) lines.push(`from .mod${pad(pick(i))} import run_${pick(3)}`);
      if (p > 0) lines.push(`from ..p${pick(p)} import helper`);
      lines.push("");
      for (let k = 0; k < 3; k++) lines.push(`def run_${k}(x):`, `    return x + ${k}`, "");
      lines.push("class Model:", "    def save(self):", "        return run_0(1)", "");
      files.set(`py/synth/p${p}/mod${pad(i)}.py`, lines.join("\n"));
      if (i === 0) reexports.push(`from .mod00 import run_0 as helper`);
    }
    files.set(`py/synth/p${p}/__init__.py`, `${reexports.join("\n")}\n`);
  }

  for (const [rel, content] of files) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  return { files: [...files.keys()].filter((f) => /\.(ts|py)$/.test(f)).length };
}
