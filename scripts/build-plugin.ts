// Builds the self-contained Claude Code plugin (ADR-0015): four bundled entry points plus the tree-sitter .wasm files,
// so the plugin works when Claude Code copies it into its cache. Run: pnpm build:plugin [--out <dir>]
// A plugin installed from a local checkout runs from plugins/claude-code/dist in place, so the new build is written
// next to it and swapped in with renames: a running session never sees a half-written dist/.
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const ROOT = join(import.meta.dirname, "..");
const { values } = parseArgs({ options: { out: { type: "string" } } });
const OUT = values.out ? resolve(values.out) : join(ROOT, "plugins/claude-code/dist");
const STAGE = `${OUT}.tmp-${process.pid}`;

mkdirSync(dirname(OUT), { recursive: true });
rmSync(STAGE, { recursive: true, force: true });
await build({
  entryPoints: {
    catenet: join(ROOT, "packages/cli/src/main.ts"),
    daemon: join(ROOT, "packages/daemon/src/main.ts"),
    "index-worker": join(ROOT, "packages/daemon/src/index-worker.ts"),
    hook: join(ROOT, "packages/adapters/claude-code/src/hook.ts"),
  },
  outdir: STAGE,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Workspace packages resolve to their TypeScript sources; third-party packages to their published builds.
  conditions: ["@catenet/source"],
  // Some dependencies still call require(); give ESM bundles a working one.
  banner: {
    js: 'import { createRequire as __catenetRequire } from "node:module"; const require = __catenetRequire(import.meta.url);',
  },
  logLevel: "warning",
});

const require = createRequire(join(ROOT, "packages/parsers/package.json"));
mkdirSync(join(STAGE, "wasm"), { recursive: true });
for (const wasm of [
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-typescript/tree-sitter-typescript.wasm",
  "tree-sitter-typescript/tree-sitter-tsx.wasm",
  "tree-sitter-javascript/tree-sitter-javascript.wasm",
  "tree-sitter-python/tree-sitter-python.wasm",
]) {
  copyFileSync(require.resolve(wasm), join(STAGE, "wasm", basename(wasm)));
}
const old = `${OUT}.old-${process.pid}`;
if (existsSync(OUT)) renameSync(OUT, old);
renameSync(STAGE, OUT);
rmSync(old, { recursive: true, force: true });
console.log(`plugin built in ${OUT}`);
