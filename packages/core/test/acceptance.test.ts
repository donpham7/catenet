// M1 gate: index each fixture and reproduce its hand-written answer key exactly (ROADMAP M1, ADR-0008).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Graph, indexRepo, openGraph } from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");

interface KeyDependent {
  file: string;
  confidence: string;
}
interface KeyTarget {
  target: string;
  published_api: boolean;
  target_covered: boolean;
  direct: KeyDependent[];
  transitive: KeyDependent[];
  covered: string[];
}
interface AnswerKey {
  packages: { path: string; name: string; published: boolean }[];
  externals: { from: string; specifier: string; subkind: string }[];
  targets: KeyTarget[];
}

const byFile = (a: { file: string }, b: { file: string }) => a.file.localeCompare(b.file);
const pairs = (xs: KeyDependent[]) => xs.map(({ file, confidence }) => ({ file, confidence })).sort(byFile);

for (const name of readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()) {
  describe(`fixture ${name}`, () => {
    const key = JSON.parse(readFileSync(join(FIXTURES, name, "answer-key.json"), "utf8")) as AnswerKey;
    const tmp = mkdtempSync(join(tmpdir(), `catenet-${name}-`));
    let graph: Graph;

    beforeAll(async () => {
      const dbPath = join(tmp, "graph.db");
      await indexRepo({ root: join(FIXTURES, name, "repo"), dbPath, full: true });
      graph = openGraph(dbPath);
    });
    afterAll(() => {
      graph?.close();
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    it("discovers the packages", () => {
      expect(graph.packages().sort((a, b) => a.path.localeCompare(b.path))).toEqual(
        [...key.packages].sort((a, b) => a.path.localeCompare(b.path)),
      );
    });

    it("classifies every external import", () => {
      const sort = (xs: AnswerKey["externals"]) =>
        [...xs].sort((a, b) => `${a.from}|${a.specifier}`.localeCompare(`${b.from}|${b.specifier}`));
      expect(sort(graph.externals())).toEqual(sort(key.externals));
    });

    for (const t of key.targets) {
      describe(t.target, () => {
        it("direct dependents (file + confidence)", () => {
          expect(pairs(graph.dependents(t.target).direct)).toEqual(pairs(t.direct));
        });
        it("transitive dependents (file + confidence)", () => {
          expect(pairs(graph.dependents(t.target).transitive)).toEqual(pairs(t.transitive));
        });
        it("static test coverage", () => {
          const impact = graph.impact(t.target);
          expect([...impact.tests.covered].sort()).toEqual([...t.covered].sort());
          expect(impact.tests.targetCovered).toBe(t.target_covered);
        });
        it("published API", () => {
          expect(graph.impact(t.target).publishedApi).toBe(t.published_api);
        });
      });
    }
  });
}
