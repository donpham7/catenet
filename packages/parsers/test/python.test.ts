import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type Extractor, loadExtractor } from "../src/index.js";

const PY_BASIC = join(import.meta.dirname, "../../../fixtures/py-basic/repo");
let ex: Extractor;

beforeAll(async () => {
  ex = await loadExtractor();
});

const facts = (rel: string) => ex.extract(readFileSync(join(PY_BASIC, rel), "utf8"), "python");

describe("Python extraction", () => {
  it("relative from-imports and __all__ in a package __init__", () => {
    const f = facts("pybasic/__init__.py");
    expect(f.imports).toEqual([
      expect.objectContaining({
        specifier: ".core.money",
        kind: "static",
        level: 1,
        module: "core.money",
        bindings: [{ imported: "format_currency", local: "format_currency" }],
        wildcard: false,
      }),
      expect.objectContaining({ specifier: ".reports.report", level: 1, module: "reports.report" }),
    ]);
    expect(f.dunderAll).toEqual(["format_currency", "Report"]);
    expect(f.symbols).toEqual([]);
  });

  it("parent-relative import, inheritance, methods and calls", () => {
    const f = facts("pybasic/reports/report.py");
    expect(f.imports[0]).toMatchObject({ specifier: "..core", level: 2, module: "core" });
    expect(f.symbols.map((s) => [s.qualifiedName, s.subkind, s.exportNames])).toEqual([
      ["Report", "class", ["Report"]],
      ["Report.__init__", "method", []],
      ["Report.render", "method", []],
    ]);
    expect(f.heritage).toEqual([{ className: "Report", base: "BaseReport", line: 6 }]);
    expect(f.references).toContainEqual({
      local: "format_currency",
      line: 11,
      enclosing: "Report.render",
      isCall: true,
    });
  });

  it("wildcard import", () => {
    const f = facts("pybasic/reports/summary.py");
    expect(f.imports[0]).toMatchObject({
      specifier: "pybasic.core.money",
      level: 0,
      wildcard: true,
      bindings: [],
    });
    expect(f.references).toContainEqual(
      expect.objectContaining({ local: "format_currency", enclosing: "summary", isCall: true }),
    );
  });

  it("aliased module import with attribute access", () => {
    const f = facts("pybasic/billing/invoice.py");
    expect(f.imports[0]).toMatchObject({
      specifier: "pybasic.core.money",
      bindings: [{ imported: "*", local: "m" }],
    });
    expect(f.references).toContainEqual({
      local: "m",
      member: "format_currency",
      line: 6,
      enclosing: "invoice_line",
      isCall: true,
    });
  });

  it("import inside try/except", () => {
    expect(facts("pybasic/billing/compat.py").imports).toEqual([
      expect.objectContaining({
        specifier: "pybasic.core.dates",
        bindings: [{ imported: "format_date", local: "format_date" }],
      }),
    ]);
  });

  it("importlib with literal and f-string names, plus the stdlib import", () => {
    const f = facts("pybasic/plugins/loader.py");
    expect(f.imports).toEqual([
      expect.objectContaining({
        specifier: "importlib",
        kind: "static",
        bindings: [{ imported: "*", local: "importlib" }],
      }),
      expect.objectContaining({
        specifier: "pybasic.plugins.csv_export",
        kind: "importlib",
        literal: true,
        line: 6,
      }),
      expect.objectContaining({
        specifier: "pybasic.plugins.{name}",
        kind: "importlib",
        literal: false,
        line: 10,
      }),
    ]);
  });

  it("module-level __all__ and functions", () => {
    const f = facts("pybasic/core/money.py");
    expect(f.dunderAll).toEqual(["format_currency", "round_amount"]);
    expect(f.symbols.map((s) => [s.name, s.exportNames])).toEqual([
      ["round_amount", ["round_amount"]],
      ["format_currency", ["format_currency"]],
    ]);
  });
});

describe("Python inline cases", () => {
  it("multiple modules, aliases and dotted unaliased imports", () => {
    const f = ex.extract(`import os, sys as system\nimport a.b.c\nfrom . import sibling as sib\n`, "python");
    expect(f.imports.map((i) => [i.specifier, i.bindings])).toEqual([
      ["os", [{ imported: "*", local: "os" }]],
      ["sys", [{ imported: "*", local: "system" }]],
      ["a.b.c", [{ imported: "*", local: "a.b.c" }]],
      [".", [{ imported: "sibling", local: "sib" }]],
    ]);
  });

  it("references through a dotted unaliased import", () => {
    const f = ex.extract(`import a.b.c\n\ndef f():\n    return a.b.c.thing(1)\n`, "python");
    expect(f.references).toContainEqual({
      local: "a.b.c",
      member: "thing",
      line: 4,
      enclosing: "f",
      isCall: true,
    });
  });

  it("private names are not exported without __all__; top-level variables are symbols", () => {
    const f = ex.extract(`_cache = {}\nLIMIT = 3\n\ndef _helper():\n    pass\n`, "python");
    expect(f.symbols.map((s) => [s.name, s.subkind, s.exportNames])).toEqual([
      ["_cache", "variable", []],
      ["LIMIT", "variable", ["LIMIT"]],
      ["_helper", "function", []],
    ]);
  });

  it("__all__ overrides public-name export", () => {
    const f = ex.extract(`__all__ = ["a"]\n\ndef a():\n    pass\n\ndef b():\n    pass\n`, "python");
    expect(f.symbols.map((s) => [s.name, s.exportNames])).toEqual([
      ["a", ["a"]],
      ["b", []],
    ]);
  });

  it("imported names used as default argument values are references", () => {
    const f = ex.extract(
      `from m import fmt, LIMIT\n\ndef render(x, f=fmt):\n    return f(x)\n\ndef cap(x: int = LIMIT):\n    return x\n`,
      "python",
    );
    expect(f.references.map((r) => [r.local, r.enclosing])).toEqual([
      ["fmt", "render"],
      ["LIMIT", "cap"],
    ]);
  });

  it("relative importlib names keep their level", () => {
    const f = ex.extract(
      `import importlib\n\nm = importlib.import_module("..pkg.mod", __package__)\n`,
      "python",
    );
    expect(f.imports[1]).toMatchObject({
      kind: "importlib",
      specifier: "..pkg.mod",
      level: 2,
      module: "pkg.mod",
      literal: true,
    });
  });

  it("decorated definitions and parenthesized from-imports", () => {
    const f = ex.extract(`from m import (x, y as z)\n\n@decorator\ndef g():\n    return x() + z\n`, "python");
    expect(f.imports[0]?.bindings).toEqual([
      { imported: "x", local: "x" },
      { imported: "y", local: "z" },
    ]);
    expect(f.symbols.map((s) => s.name)).toEqual(["g"]);
    expect(f.references.map((r) => [r.local, r.enclosing, r.isCall])).toEqual([
      ["x", "g", true],
      ["z", "g", false],
    ]);
  });
});
