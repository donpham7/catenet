// Incremental indexing must produce exactly the graph a full rebuild produces (ADR-0013).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type IndexStats, indexRepo, openGraph } from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");

interface Step {
  name: string;
  mode: IndexStats["mode"];
  apply: (repo: string) => void;
}

const edit = (file: string, from: string | RegExp, to: string) => (repo: string) => {
  const path = join(repo, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(from, to);
  if (after === before) throw new Error(`edit did not change ${file}`);
  writeFileSync(path, after);
};

const SCENARIOS: Record<string, Step[]> = {
  "ts-basic": [
    {
      name: "body edit (no export change)",
      mode: "update",
      apply: edit("src/lib/format.ts", "slice(0, 10)", "slice(0, 7)"),
    },
    {
      name: "rename an exported function",
      mode: "update",
      apply: edit("src/lib/math.ts", "function clamp(", "function clampValue("),
    },
    {
      name: "barrel stops re-exporting a module",
      mode: "update",
      apply: edit("src/lib/index.ts", 'export * from "./math";\n', ""),
    },
    {
      name: "edit a file reached through the barrel",
      mode: "update",
      apply: edit("src/checkout/total.ts", "sum + m.amount", "sum + m.amount * 1"),
    },
    {
      name: "add a file",
      mode: "update",
      apply: (repo) =>
        writeFileSync(
          join(repo, "src/new.ts"),
          'import { formatCurrency } from "./lib/format";\nexport const x = formatCurrency(1);\n',
        ),
    },
    { name: "delete a file", mode: "update", apply: (repo) => rmSync(join(repo, "src/plugins/csv.ts")) },
    {
      name: "delete a module that a barrel re-exports",
      mode: "update",
      apply: (repo) => rmSync(join(repo, "src/lib/format.ts")),
    },
    {
      name: "re-add it with a different export",
      mode: "update",
      apply: (repo) =>
        writeFileSync(
          join(repo, "src/lib/format.ts"),
          "export function formatCurrency(n: number): string {\n  return String(n);\n}\n",
        ),
    },
    {
      name: "switch to an export clause",
      mode: "update",
      apply: (repo) =>
        writeFileSync(
          join(repo, "src/lib/math.ts"),
          "function round(n: number): number {\n  return Math.round(n);\n}\n\nfunction clampValue(n: number): number {\n  return n;\n}\n\nexport { round, clampValue };\n",
        ),
    },
    {
      name: "change the kind of a symbol exported through the clause",
      mode: "update",
      apply: edit(
        "src/lib/math.ts",
        "function round(n: number): number {\n  return Math.round(n);\n}",
        "const round = (n: number): number => Math.round(n);",
      ),
    },
    { name: "no change", mode: "noop", apply: () => {} },
  ],
  "py-basic": [
    { name: "body edit", mode: "update", apply: edit("pybasic/core/money.py", "round(x, 2)", "round(x, 3)") },
    {
      name: "rename a function used through re-exports and star imports",
      mode: "update",
      apply: (repo) => {
        edit("pybasic/core/money.py", /format_currency/g, "fmt_currency")(repo);
      },
    },
    {
      name: "package __init__ drops a re-export",
      mode: "update",
      apply: edit("pybasic/core/__init__.py", ", round_amount", ""),
    },
    {
      name: "add a submodule that shadows nothing but is imported",
      mode: "update",
      apply: (repo) => {
        writeFileSync(
          join(repo, "pybasic/core/extra.py"),
          "from .money import round_amount\n\n\ndef twice(x):\n    return round_amount(x) * 2\n",
        );
        edit(
          "pybasic/billing/invoice.py",
          "import pybasic.core.money as m",
          "import pybasic.core.money as m\nfrom pybasic.core import extra",
        )(repo);
      },
    },
    { name: "delete a module", mode: "update", apply: (repo) => rmSync(join(repo, "pybasic/core/dates.py")) },
  ],
  "monorepo-mixed": [
    {
      name: "rename an export used across packages",
      mode: "update",
      apply: edit("packages/utils/src/strings.ts", "function slugify(", "function toSlug("),
    },
    {
      name: "body edit in a published package",
      mode: "update",
      apply: edit("packages/ui/src/price-tag.ts", "<span", "<b"),
    },
    {
      name: "manifest change triggers rebuild",
      mode: "rebuild",
      apply: edit("packages/ui/package.json", '"1.0.0"', '"1.0.1"'),
    },
  ],
};

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

for (const [fixture, steps] of Object.entries(SCENARIOS)) {
  describe(`incremental == full: ${fixture}`, () => {
    const tmp = mkdtempSync(join(tmpdir(), `catenet-inc-${fixture}-`));
    temps.push(tmp);
    const repo = join(tmp, "repo");
    cpSync(join(FIXTURES, fixture, "repo"), repo, {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).includes(".catenet"),
    });
    const incDb = join(tmp, "incremental.db");

    it("initial index", async () => {
      expect((await indexRepo({ root: repo, dbPath: incDb })).mode).toBe("rebuild");
    });

    steps.forEach((step, i) => {
      it(`${i + 1}. ${step.name}`, async () => {
        step.apply(repo);
        const stats = await indexRepo({ root: repo, dbPath: incDb });
        expect(stats.mode).toBe(step.mode);
        const fullDb = join(tmp, `full-${i}.db`);
        await indexRepo({ root: repo, dbPath: fullDb, full: true });
        const inc = openGraph(incDb);
        const full = openGraph(fullDb);
        try {
          expect(inc.dump()).toEqual(full.dump());
        } finally {
          inc.close();
          full.close();
        }
      });
    });
  });
}
