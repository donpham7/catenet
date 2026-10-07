// Regression tests for the M1 code review findings. Each test failed before its fix.
import { spawn } from "node:child_process";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { pendingChanges, TargetError } from "../src/index.js";
import { makeRepo, type TempRepo } from "./helpers.js";

let repo: TempRepo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
});

describe("stored facts are never trusted across a full rebuild or an extractor change (review #1)", () => {
  const files = {
    "src/lib.ts": "export function f(): number {\n  return 1;\n}\n",
    "src/use.ts": 'import { f } from "./lib";\nexport const x = f();\n',
  };
  const corruptStoredFacts = (dbPath: string) => {
    const db = new DatabaseSync(dbPath);
    const empty = JSON.stringify({
      lang: "typescript",
      symbols: [],
      imports: [],
      references: [],
      heritage: [],
      localExports: [],
      dunderAll: null,
      parseErrors: 0,
    });
    db.prepare("UPDATE file_facts SET facts_json = ?").run(empty);
    db.close();
  };

  it("--full re-extracts every file", async () => {
    repo = makeRepo(files);
    await repo.index(true);
    corruptStoredFacts(repo.dbPath);
    await repo.index(true);
    const g = repo.graph();
    expect(g.dependents("src/lib.ts").direct.map((d) => d.file)).toEqual(["src/use.ts"]);
    g.close();
  });

  it("a different extractor version forces re-extraction", async () => {
    repo = makeRepo(files);
    await repo.index(true);
    corruptStoredFacts(repo.dbPath);
    const db = new DatabaseSync(repo.dbPath);
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'extractor_version'").run();
    db.close();
    const stats = await repo.index();
    expect(stats.mode).toBe("rebuild");
    expect(stats.extracted).toBe(2);
    const g = repo.graph();
    expect(g.dependents("src/lib.ts").direct.map((d) => d.file)).toEqual(["src/use.ts"]);
    g.close();
  });
});

describe("tsconfig paths resolve like TypeScript (review #4)", () => {
  it("uses the longest matching pattern and falls back to normal resolution", async () => {
    repo = makeRepo({
      "package.json": JSON.stringify({ name: "app", dependencies: { react: "19.0.0" } }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "*": ["types/*"], "@app/*": ["src/*"] } },
      }),
      "types/vendor.d.ts": "export {};\n",
      "src/b.ts": "export const b = 1;\n",
      "src/a.ts": [
        'import React from "react";',
        'import { readFileSync } from "fs";',
        'import { b } from "@app/b";',
        "export const a = String(React) + String(readFileSync) + b;",
        "",
      ].join("\n"),
    });
    await repo.index(true);
    const g = repo.graph();
    expect(g.externals().sort((x, y) => x.specifier.localeCompare(y.specifier))).toEqual([
      { from: "src/a.ts", specifier: "fs", subkind: "builtin" },
      { from: "src/a.ts", specifier: "react", subkind: "third_party" },
    ]);
    expect(g.dependents("src/b.ts").direct.map((d) => d.file)).toEqual(["src/a.ts"]);
    g.close();
  });
});

describe("published API through wildcard subpath exports (review #8)", () => {
  it("marks files exposed by an exports pattern as published", async () => {
    repo = makeRepo({
      "package.json": JSON.stringify({
        name: "lib",
        exports: { ".": "./src/index.ts", "./utils/*": "./src/utils/*.ts" },
      }),
      "src/index.ts": "export const main = 1;\n",
      "src/utils/format.ts": "export function fmt(): string {\n  return '';\n}\n",
      "src/internal/hidden.ts": "export const hidden = 1;\n",
    });
    await repo.index(true);
    const g = repo.graph();
    expect(g.impact("src/utils/format.ts").publishedApi).toBe(true);
    expect(g.impact("src/internal/hidden.ts").publishedApi).toBe(false);
    g.close();
  });
});

describe("symbol targets (review #6, #7)", () => {
  const files = {
    "src/a.ts": "export function formatCurrency(): string {\n  return '';\n}\n",
    "src/b.ts": [
      "export class Formatter {",
      "  FormatCurrency(): string {",
      "    return '';",
      "  }",
      "}",
      "export class Widget {",
      "  render(): void {}",
      "}",
      "export class Panel {",
      "  render(): void {}",
      "}",
      "",
    ].join("\n"),
  };

  it("bare symbol names match case-sensitively", async () => {
    repo = makeRepo(files);
    await repo.index(true);
    const g = repo.graph();
    expect(g.findSymbols("formatCurrency").map((s) => s.id)).toEqual(["src/a.ts#formatCurrency"]);
    expect(g.dependents("formatCurrency").target.id).toBe("src/a.ts#formatCurrency");
    g.close();
  });

  it("path#short that matches several qualified symbols is ambiguous", async () => {
    repo = makeRepo(files);
    await repo.index(true);
    const g = repo.graph();
    let error: unknown;
    try {
      g.dependents("src/b.ts#render");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TargetError);
    expect((error as TargetError).candidates).toEqual(["src/b.ts#Panel.render", "src/b.ts#Widget.render"]);
    expect(g.dependents("src/b.ts#Widget.render").target.id).toBe("src/b.ts#Widget.render");
    g.close();
  });

  it("targets accept ./ and redundant path segments", async () => {
    repo = makeRepo(files);
    await repo.index(true);
    const g = repo.graph();
    expect(g.dependents("./src/a.ts").target.id).toBe("src/a.ts");
    expect(g.dependents("src//lib/../a.ts#formatCurrency").target.id).toBe("src/a.ts#formatCurrency");
    g.close();
  });
});

// ---------------------------------------------------------------- second review

describe("upgrade with edited files does not touch old-format facts (review 2 #1)", () => {
  it("rebuilds instead of analysing facts written by another extractor version", async () => {
    repo = makeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
    });
    await repo.index(true);
    const db = new DatabaseSync(repo.dbPath);
    // An older FileFacts shape: no localExports field at all.
    db.prepare("UPDATE file_facts SET facts_json = ?").run(
      JSON.stringify({ lang: "typescript", symbols: [], imports: [] }),
    );
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'extractor_version'").run();
    db.close();
    repo.write("src/a.ts", "export const a = 2;\n");
    const stats = await repo.index();
    expect(stats.mode).toBe("rebuild");
    const g = repo.graph();
    expect(g.dependents("src/a.ts").direct.map((d) => d.file)).toEqual(["src/b.ts"]);
    g.close();
  });
});

describe("concurrent writers wait instead of failing (review 2 #2)", () => {
  it("indexes while another process briefly holds the write lock", async () => {
    repo = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    await repo.index(true);
    repo.write("src/a.ts", "export const a = 2;\n");
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const db = new DatabaseSync(${JSON.stringify(repo.dbPath)});
         db.exec("BEGIN IMMEDIATE");
         process.stdout.write("locked\\n");
         Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
         db.exec("COMMIT");`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve) => holder.stdout?.once("data", () => resolve()));
    const stats = await repo.index();
    expect(stats.mode).toBe("update");
    await new Promise((resolve) => holder.once("exit", resolve));
  });
});

describe("tsconfig extends chains count as config (review 2 #4)", () => {
  it("an edit to an extended base config with any name triggers a rebuild", async () => {
    repo = makeRepo({
      "tsconfig.json": JSON.stringify({ extends: "./configs/base.json" }),
      "configs/base.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["../src/*"] } } }),
      "src/b.ts": "export const b = 1;\n",
      "lib/b.ts": "export const b = 2;\n",
      "src/a.ts": 'import { b } from "@/b";\nexport const a = b;\n',
    });
    await repo.index(true);
    repo.write("configs/base.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["../lib/*"] } } }));
    const stats = await repo.index();
    expect(stats.mode).toBe("rebuild");
    const g = repo.graph();
    expect(g.dependents("lib/b.ts").direct.map((d) => d.file)).toEqual(["src/a.ts"]);
    expect(g.dependents("src/b.ts").direct).toEqual([]);
    g.close();
  });
});

describe("Python resolution edge cases (review 2 #5, #6, #7)", () => {
  it("relative importlib names resolve against the importing file's package", async () => {
    repo = makeRepo({
      "pyproject.toml": '[project]\nname = "app"\n',
      "app/__init__.py": "",
      "app/handlers.py": "def handle():\n    pass\n",
      "app/loader.py":
        'import importlib\n\n\ndef load():\n    return importlib.import_module(".handlers", __package__)\n',
    });
    await repo.index(true);
    const g = repo.graph();
    expect(g.dependents("app/handlers.py").direct).toEqual([
      { file: "app/loader.py", confidence: "heuristic" },
    ]);
    expect(g.externals()).toEqual([{ from: "app/loader.py", specifier: "importlib", subkind: "builtin" }]);
    g.close();
  });

  it("`from . import b` works when the repo root is itself a package", async () => {
    repo = makeRepo({ "__init__.py": "", "b.py": "X = 1\n", "a.py": "from . import b\n\nY = b.X\n" });
    await repo.index(true);
    const g = repo.graph();
    expect(g.dependents("b.py").direct.map((d) => d.file)).toEqual(["a.py"]);
    g.close();
  });

  it("a root setup.py without a name is called root, like the other manifests", async () => {
    repo = makeRepo({ "setup.py": "from setuptools import setup\nsetup()\n", "m.py": "X = 1\n" });
    await repo.index(true);
    const g = repo.graph();
    expect(g.packages()).toEqual([{ path: ".", name: "root", published: false }]);
    g.close();
  });
});

describe("TS resolution prefers the .ts sibling of a .js specifier (review 2 #8)", () => {
  it("resolves ./util.js to util.ts when both exist", async () => {
    repo = makeRepo({
      "src/util.ts": "export const u = 1;\n",
      "src/util.js": "exports.u = 1;\n",
      "src/main.ts": 'import { u } from "./util.js";\nexport const m = u;\n',
    });
    await repo.index(true);
    const g = repo.graph();
    expect(g.dependents("src/util.ts").direct.map((d) => d.file)).toEqual(["src/main.ts"]);
    expect(g.dependents("src/util.js").direct).toEqual([]);
    g.close();
  });
});

describe("a no-change run returns before reading stored facts (review 2 #9)", () => {
  it("does not parse facts when nothing changed", async () => {
    repo = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    await repo.index(true);
    const db = new DatabaseSync(repo.dbPath);
    db.prepare("UPDATE file_facts SET facts_json = 'not json'").run();
    db.close();
    const stats = await repo.index();
    expect(stats.mode).toBe("noop");
    expect(stats.extracted).toBe(0);
  });
});

// ---------------------------------------------------------------- M2 review

describe("graphs missing M2 metadata are backfilled on the next run (M2 review #9)", () => {
  it("does not take the no-change shortcut when indexed_at or entry_points are missing", async () => {
    repo = makeRepo({
      "package.json": JSON.stringify({ name: "lib", exports: { ".": "./src/index.ts" } }),
      "src/index.ts": "export const a = 1;\n",
    });
    await repo.index(true);
    const db = new DatabaseSync(repo.dbPath);
    db.prepare("DELETE FROM meta WHERE key IN ('indexed_at', 'entry_points')").run();
    db.close();
    const stats = await repo.index();
    expect(stats.mode).not.toBe("noop");
    const g = repo.graph();
    expect(g.repoMap().entryPoints).toEqual([{ package: "lib", file: "src/index.ts" }]);
    expect(g.indexInfo().indexedAt).not.toBeNull();
    g.close();
  });
});

describe("pendingChanges never throws on unreadable files (M2 review #10)", () => {
  it("counts an unreadable file as changed", async () => {
    repo = makeRepo({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    await repo.index(true);
    const path = `${repo.root}/src/b.ts`;
    chmodSync(path, 0o000);
    try {
      expect(pendingChanges(repo.root, repo.dbPath)).toEqual({ changed: 1, added: 0, deleted: 0 });
    } finally {
      chmodSync(path, 0o644);
    }
  });
});
