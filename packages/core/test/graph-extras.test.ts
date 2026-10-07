// M2 core additions: tests_for, repo_map, index info, version, shared sanitizer.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CATENET_VERSION,
  type Graph,
  indexRepo,
  openGraph,
  sanitizeText,
  TargetError,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");
const tmp = mkdtempSync(join(tmpdir(), "catenet-extras-"));
const graphs: Record<string, Graph> = {};

beforeAll(async () => {
  for (const name of ["ts-basic", "monorepo-mixed", "py-basic"]) {
    const repo = join(tmp, name);
    cpSync(join(FIXTURES, name, "repo"), repo, {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).includes(".catenet"),
    });
    const dbPath = join(tmp, `${name}.db`);
    await indexRepo({ root: repo, dbPath, full: true });
    graphs[name] = openGraph(dbPath);
  }
});
afterAll(() => {
  for (const g of Object.values(graphs)) g.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("testsFor", () => {
  it("lists test files with a static tests edge to the target", () => {
    expect(graphs["ts-basic"]?.testsFor("src/lib/format.ts")).toEqual(["test/format.test.ts"]);
    expect(graphs["ts-basic"]?.testsFor("src/ui/widget.ts#Widget")).toEqual(["test/widget.test.ts"]);
    expect(graphs["ts-basic"]?.testsFor("src/lib/math.ts")).toEqual([]);
  });
});

describe("repoMap", () => {
  it("summarises packages, directories, published entry points and hubs", () => {
    const map = graphs["monorepo-mixed"]?.repoMap();
    expect(map?.packages).toEqual([
      { path: ".", name: "acme-monorepo", published: false, files: 0 },
      { path: "apps/web", name: "web", published: false, files: 3 },
      { path: "packages/ui", name: "@acme/ui", published: true, files: 4 },
      { path: "packages/utils", name: "@acme/utils", published: true, files: 3 },
      { path: "services/billing", name: "acme-billing", published: true, files: 4 },
    ]);
    expect(map?.entryPoints).toEqual([
      { package: "@acme/ui", file: "packages/ui/src/index.ts" },
      { package: "@acme/utils", file: "packages/utils/src/index.ts" },
      { package: "acme-billing", file: "services/billing/acme_billing/__init__.py" },
    ]);
    expect(map?.hubs[0]).toEqual({ file: "packages/ui/src/price-tag.ts", directDependents: 2 });
    expect(map?.counts).toMatchObject({ files: 14, testFiles: 2 });
    expect(map?.directories.find((d) => d.path === "packages")?.files).toBe(7);
  });
});

describe("indexInfo and version", () => {
  it("reports when and with what the graph was built", () => {
    const info = graphs["ts-basic"]?.indexInfo();
    expect(info?.files).toBe(23);
    expect(Number.isNaN(Date.parse(info?.indexedAt ?? ""))).toBe(false);
    expect(info?.schemaVersion).toBe(1);
    expect(typeof info?.extractorVersion).toBe("number");
    expect(CATENET_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("sanitizeText", () => {
  it("is the shared sanitizer for agent- and terminal-visible repo text", () => {
    expect(sanitizeText("a.ts\n  injected\x1b[31m")).toBe("a.ts  injected");
    expect(sanitizeText("x".repeat(500), 10)).toBe("xxxxxxxxx…");
  });

  it("removes invisible and line-breaking characters a model would still read", () => {
    const sneaky = [
      "pkg",
      "\u2028", // line separator
      "\u2029", // paragraph separator
      "\u200b", // zero-width space
      "\ufeff", // byte-order mark
      String.fromCodePoint(0xe0049, 0xe0047), // invisible tag characters
      "\u202e", // bidi override
      "name",
    ].join("");
    expect(sanitizeText(sneaky)).toBe("pkgname");
  });
});

/** Every file and symbol in a graph, as targets. */
function allTargets(g: Graph): string[] {
  const targets = new Set<string>();
  for (const row of g.dump().nodes) {
    const [kind, path, name] = (JSON.parse(row) as [string])[0].split(":");
    if (kind === "file" && path) targets.add(path);
    if (kind === "symbol" && path && name) targets.add(`${path}#${name}`);
  }
  return [...targets].sort();
}

function expectAgreement(g: Graph, target: string, label: string): void {
  let full: ReturnType<Graph["impact"]>;
  try {
    full = g.impact(target);
  } catch (err) {
    if (err instanceof TargetError) return; // e.g. an ambiguous overloaded name
    throw err;
  }
  expect(g.impactSummary(target), `${label} ${target}`).toEqual({
    target: full.target.id,
    direct: full.direct.map((d) => d.file),
    transitiveCount: full.transitive.length,
    packageCount: full.packages.length,
    publishedApi: full.publishedApi,
    coveredDependents: full.tests.covered.length,
    targetCovered: full.tests.targetCovered,
  });
}

describe("impactSummary (the fast path behind injected context)", () => {
  it("agrees with impact() for every file and symbol in every fixture", () => {
    for (const [name, g] of Object.entries(graphs)) {
      const targets = allTargets(g);
      expect(targets.length).toBeGreaterThan(5);
      for (const target of targets) expectAgreement(g, target, name);
    }
  });

  it("agrees for a symbol whose file sits in an import cycle, and orders paths like impact()", async () => {
    // a.ts exports foo and bar and imports b.ts; b.ts uses foo; c.ts uses only bar. B.ts sorts differently by byte
    // order and by locale.
    const repo = join(tmp, "cycle");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(
      join(repo, "src/a.ts"),
      'import { b } from "./b";\nexport const foo = () => b;\nexport const bar = 2;\n',
    );
    writeFileSync(
      join(repo, "src/b.ts"),
      'import { foo } from "./a";\nexport const b = 1;\nexport const useFoo = foo;\n',
    );
    writeFileSync(join(repo, "src/c.ts"), 'import { bar } from "./a";\nexport const c = bar;\n');
    writeFileSync(join(repo, "src/B2.ts"), 'import { foo } from "./a";\nexport const d = foo;\n');
    const dbPath = join(tmp, "cycle.db");
    await indexRepo({ root: repo, dbPath, full: true });
    const g = openGraph(dbPath);
    try {
      expect(g.impactSummary("src/a.ts#foo").transitiveCount).toBe(
        g.impact("src/a.ts#foo").transitive.length,
      );
      for (const target of allTargets(g)) expectAgreement(g, target, "cycle");
    } finally {
      g.close();
    }
  });
});
