// Consistency checks for fixture answer keys (fixtures/README.md). These keep the ground truth honest until M1
// can compare it against a real indexer.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");

interface Dependent {
  file: string;
  confidence: string;
  via?: string;
}

interface Target {
  target: string;
  published_api: boolean;
  target_covered: boolean;
  direct: Dependent[];
  transitive: Dependent[];
  covered: string[];
  notes: string;
}

interface AnswerKey {
  fixture: string;
  definitions: string;
  packages: { path: string; name: string; published: boolean }[];
  externals: { from: string; specifier: string; subkind: string }[];
  protected_path_candidates: string[];
  targets: Target[];
}

const CONFIDENCES = new Set(["exact", "heuristic"]);
const EXTERNAL_SUBKINDS = new Set(["third_party", "builtin", "unresolved"]);

function isTestFile(path: string): boolean {
  return (
    /(^|\/)(test|tests)\//.test(path) ||
    /\.test\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)test_[^/]+\.py$/.test(path)
  );
}

const fixtureNames = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("fixture answer keys", () => {
  it("finds the M0 fixtures and the M4 eval repository", () => {
    expect(fixtureNames).toEqual(["eval-shop", "monorepo-mixed", "py-basic", "ts-basic"]);
  });

  for (const name of fixtureNames) {
    describe(name, () => {
      const repo = join(FIXTURES, name, "repo");
      const key = JSON.parse(readFileSync(join(FIXTURES, name, "answer-key.json"), "utf8")) as AnswerKey;
      const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
      const mustExist = (rel: string) => expect(existsSync(join(repo, rel)), `${rel} exists`).toBe(true);

      it("names itself correctly and cites its definitions", () => {
        expect(key.fixture).toBe(name);
        expect(key.definitions).toContain("ADR-0008");
        expect(key.targets.length).toBeGreaterThan(0);
      });

      it("declares packages that are real build units", () => {
        for (const pkg of key.packages) {
          const manifest = ["package.json", "pyproject.toml", "setup.py"].find((m) =>
            existsSync(join(repo, pkg.path, m)),
          );
          expect(manifest, `${pkg.path} has a package manifest`).toBeDefined();
          if (manifest === "package.json") {
            const json = JSON.parse(read(join(pkg.path, manifest))) as { name?: string; private?: boolean };
            expect(json.name).toBe(pkg.name);
            expect(pkg.published).toBe(json.private !== true);
          }
        }
      });

      it("lists externals that appear in their source files", () => {
        for (const ext of key.externals) {
          expect(EXTERNAL_SUBKINDS.has(ext.subkind), `${ext.subkind} is a known subkind`).toBe(true);
          mustExist(ext.from);
          expect(read(ext.from), `${ext.from} mentions ${ext.specifier}`).toContain(ext.specifier);
        }
      });

      it("lists protected-path candidates that exist", () => {
        for (const p of key.protected_path_candidates) mustExist(p);
      });

      for (const t of key.targets) {
        describe(t.target, () => {
          const [file, symbol] = t.target.split("#") as [string, string | undefined];

          it("points at an existing file (and symbol)", () => {
            mustExist(file);
            if (symbol) expect(read(file)).toMatch(new RegExp(`\\b${symbol}\\b`));
          });

          it("has well-formed dependents", () => {
            for (const d of [...t.direct, ...t.transitive]) {
              mustExist(d.file);
              expect(CONFIDENCES.has(d.confidence), `${d.file}: ${d.confidence}`).toBe(true);
              expect(isTestFile(d.file), `${d.file} must not be a test file`).toBe(false);
              expect(d.file, "target is never its own dependent").not.toBe(file);
            }
            for (const d of t.direct) expect(d.via, `${d.file} explains its edge`).toBeTruthy();
          });

          it("keeps direct within transitive, and covered within transitive", () => {
            const transitive = new Set(t.transitive.map((d) => d.file));
            expect(transitive.size, "no duplicate transitive entries").toBe(t.transitive.length);
            for (const d of t.direct) expect(transitive.has(d.file), `${d.file} in transitive`).toBe(true);
            for (const c of t.covered) expect(transitive.has(c), `${c} in transitive`).toBe(true);
          });

          it("never upgrades a heuristic direct edge to exact transitively", () => {
            const transitive = new Map(t.transitive.map((d) => [d.file, d.confidence]));
            for (const d of t.direct) {
              if (d.confidence === "exact") expect(transitive.get(d.file)).toBe("exact");
            }
          });
        });
      }
    });
  }
});
