// M2 core additions: tests_for, repo_map, index info, version, shared sanitizer.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATENET_VERSION, type Graph, indexRepo, openGraph, sanitizeText } from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");
const tmp = mkdtempSync(join(tmpdir(), "catenet-extras-"));
const graphs: Record<string, Graph> = {};

beforeAll(async () => {
  for (const name of ["ts-basic", "monorepo-mixed"]) {
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
});
