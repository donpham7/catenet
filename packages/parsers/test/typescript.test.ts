import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type Extractor, langForPath, loadExtractor } from "../src/index.js";

const TS_BASIC = join(import.meta.dirname, "../../../fixtures/ts-basic/repo");
let ex: Extractor;

beforeAll(async () => {
  ex = await loadExtractor();
});

function facts(rel: string) {
  const lang = langForPath(rel);
  if (!lang) throw new Error(`no lang for ${rel}`);
  return ex.extract(readFileSync(join(TS_BASIC, rel), "utf8"), lang);
}

describe("langForPath", () => {
  it("maps extensions to grammars", () => {
    expect(langForPath("a.ts")).toBe("typescript");
    expect(langForPath("a.d.ts")).toBe("typescript");
    expect(langForPath("a.mts")).toBe("typescript");
    expect(langForPath("a.tsx")).toBe("tsx");
    expect(langForPath("a.cjs")).toBe("javascript");
    expect(langForPath("a.jsx")).toBe("javascript");
    expect(langForPath("a.py")).toBe("python");
    expect(langForPath("a.sql")).toBeNull();
  });
});

describe("TypeScript extraction", () => {
  it("barrel: export * and renamed re-exports", () => {
    const f = facts("src/index.ts");
    expect(f.imports).toEqual([
      expect.objectContaining({
        specifier: "./lib",
        kind: "reexport_all",
        line: 2,
        literal: true,
        bindings: [],
      }),
      expect.objectContaining({
        specifier: "./lib/format",
        kind: "reexport",
        line: 3,
        bindings: [{ imported: "formatCurrency", local: "money" }],
      }),
      expect.objectContaining({
        specifier: "./ui/widget",
        kind: "reexport",
        bindings: [{ imported: "Widget", local: "Widget" }],
      }),
    ]);
    expect(f.symbols).toEqual([]);
    expect(f.parseErrors).toBe(0);
  });

  it("named import via path alias, inheritance, method symbols and call references", () => {
    const f = facts("src/ui/widget.ts");
    expect(f.imports.map((i) => [i.specifier, i.kind, i.bindings])).toEqual([
      ["@/lib/format", "static", [{ imported: "formatCurrency", local: "formatCurrency" }]],
      ["./base", "static", [{ imported: "BaseWidget", local: "BaseWidget" }]],
    ]);
    expect(f.symbols).toEqual([
      expect.objectContaining({
        name: "Widget",
        qualifiedName: "Widget",
        subkind: "class",
        exportNames: ["Widget"],
      }),
      expect.objectContaining({
        name: "render",
        qualifiedName: "Widget.render",
        subkind: "method",
        exportNames: [],
      }),
    ]);
    expect(f.heritage).toEqual([{ className: "Widget", base: "BaseWidget", line: 5 }]);
    expect(f.references).toContainEqual({
      local: "formatCurrency",
      line: 9,
      enclosing: "Widget.render",
      isCall: true,
    });
  });

  it("type-only import and type references", () => {
    const f = facts("src/checkout/total.ts");
    expect(f.imports.map((i) => [i.specifier, i.kind])).toEqual([
      ["../lib", "static"],
      ["../lib/types", "type_only"],
    ]);
    expect(f.references).toContainEqual(
      expect.objectContaining({ local: "Money", enclosing: "total", isCall: false }),
    );
    expect(f.references).toContainEqual(
      expect.objectContaining({ local: "formatCurrency", enclosing: "total", isCall: true }),
    );
  });

  it("namespace import with member access", () => {
    const f = facts("src/checkout/summary.ts");
    expect(f.imports[0]).toMatchObject({
      specifier: "../lib/index",
      kind: "static",
      bindings: [{ imported: "*", local: "lib" }],
    });
    expect(f.references).toContainEqual({
      local: "lib",
      member: "formatCurrency",
      line: 5,
      enclosing: "summary",
      isCall: true,
    });
  });

  it("default import and default export", () => {
    expect(facts("src/checkout/receipt.ts").imports[0]).toMatchObject({
      specifier: "./receipt-format",
      bindings: [{ imported: "default", local: "formatReceipt" }],
    });
    const fmt = facts("src/checkout/receipt-format.ts");
    expect(fmt.symbols).toEqual([
      expect.objectContaining({ name: "formatReceipt", subkind: "function", exportNames: ["default"] }),
    ]);
  });

  it("literal and template dynamic imports", () => {
    const f = facts("src/plugins/loader.ts");
    expect(f.imports).toEqual([
      expect.objectContaining({ specifier: "./csv", kind: "dynamic", literal: true, line: 3 }),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the specifier is the template text as written in source
      expect.objectContaining({ specifier: "./${name}", kind: "dynamic", literal: false, line: 8 }),
    ]);
  });

  it("side-effect import", () => {
    expect(facts("src/setup.ts").imports).toEqual([
      expect.objectContaining({ specifier: "./polyfills", kind: "side_effect", bindings: [] }),
    ]);
  });

  it("import cycle files parse independently", () => {
    expect(facts("src/cycle/b.ts").imports[0]).toMatchObject({
      specifier: "./a",
      bindings: [{ imported: "a", local: "a" }],
    });
  });

  it("CommonJS require with destructuring", () => {
    const f = facts("src/legacy/report.cjs");
    expect(f.lang).toBe("javascript");
    expect(f.imports).toEqual([
      expect.objectContaining({
        specifier: "../lib/format",
        kind: "require",
        literal: true,
        bindings: [{ imported: "formatCurrency", local: "formatCurrency" }],
      }),
    ]);
    expect(f.references).toContainEqual(expect.objectContaining({ local: "formatCurrency", isCall: true }));
  });

  it("third-party default import and exported variables", () => {
    const f = facts("src/vendor.ts");
    expect(f.imports[0]).toMatchObject({
      specifier: "lodash",
      bindings: [{ imported: "default", local: "_" }],
    });
    expect(f.symbols).toEqual([
      expect.objectContaining({ name: "unique", subkind: "variable", exportNames: ["unique"] }),
    ]);
    expect(f.references).toContainEqual(
      expect.objectContaining({ local: "_", member: "uniq", isCall: true }),
    );
  });

  it("interfaces and top-level functions", () => {
    expect(facts("src/lib/types.ts").symbols).toEqual([
      expect.objectContaining({ name: "Money", subkind: "interface", exportNames: ["Money"] }),
    ]);
    expect(facts("src/lib/math.ts").symbols.map((s) => s.name)).toEqual(["round", "clamp"]);
  });
});

describe("CommonJS exports", () => {
  it("exports.x = function and module.exports.x = local", () => {
    const f = facts("src/legacy/helpers.cjs");
    expect(f.symbols).toEqual([
      expect.objectContaining({ name: "double", subkind: "function", exportNames: ["double"] }),
      expect.objectContaining({ name: "triple", subkind: "function", exportNames: [] }),
    ]);
    expect(f.localExports).toEqual([{ local: "triple", exported: "triple", line: 12 }]);
    expect(f.references).toContainEqual(
      expect.objectContaining({ local: "round", enclosing: "double", isCall: true }),
    );
  });

  it("module.exports = function is the default export", () => {
    expect(facts("src/legacy/report.cjs").symbols).toEqual([
      expect.objectContaining({ name: "report", subkind: "function", exportNames: ["default"] }),
    ]);
  });

  it("module.exports = { ... } exports each property", () => {
    const f = facts("src/legacy/consumer.cjs");
    expect(f.symbols).toEqual([
      expect.objectContaining({ name: "run", subkind: "function", exportNames: ["run"] }),
    ]);
    expect(f.references).toContainEqual(
      expect.objectContaining({ local: "helpers", member: "double", enclosing: "run", isCall: true }),
    );
    expect(f.references).toContainEqual(
      expect.objectContaining({ local: "report", enclosing: "run", isCall: true }),
    );
  });

  it("non-literal require() is kept as an unresolvable import", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source text containing a template literal
    const f = ex.extract("const p = require(`./plugins/${name}`);\nconst q = require(name);\n", "javascript");
    expect(f.imports.map((i) => [i.kind, i.specifier, i.literal])).toEqual([
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the specifier as written in source
      ["require", "./plugins/${name}", false],
      ["require", "name", false],
    ]);
  });

  it("module.exports = identifier and shorthand object properties", () => {
    const one = ex.extract(`function a() {}\nmodule.exports = a;\n`, "javascript");
    expect(one.localExports).toEqual([{ local: "a", exported: "default", line: 2 }]);
    const obj = ex.extract(
      `const { x } = require("./x");\nfunction y() {}\nmodule.exports = { x, z: y, w() {} };\n`,
      "javascript",
    );
    expect(obj.localExports).toEqual([
      { local: "x", exported: "x", line: 3 },
      { local: "y", exported: "z", line: 3 },
    ]);
    expect(obj.symbols.map((s) => [s.name, s.exportNames])).toEqual([
      ["y", []],
      ["w", ["w"]],
    ]);
  });
});

describe("TypeScript inline cases", () => {
  it("local export clause and export default identifier", () => {
    const f = ex.extract(
      `import { a } from "./a";\nconst b = 1;\nexport { a as c, b };\nexport default b;\n`,
      "typescript",
    );
    expect(f.localExports).toEqual([
      { local: "a", exported: "c", line: 3 },
      { local: "b", exported: "b", line: 3 },
      { local: "b", exported: "default", line: 4 },
    ]);
  });

  it("export * as namespace", () => {
    const f = ex.extract(`export * as utils from "./utils";\n`, "typescript");
    expect(f.imports[0]).toMatchObject({ kind: "reexport", bindings: [{ imported: "*", local: "utils" }] });
  });

  it("JSX component references", () => {
    const f = ex.extract(
      `import { Button } from "./button";\nexport const App = () => <Button label="x" />;\n`,
      "tsx",
    );
    expect(f.references).toContainEqual(expect.objectContaining({ local: "Button", enclosing: "App" }));
  });

  it("counts parse errors", () => {
    expect(ex.extract(`export function (`, "typescript").parseErrors).toBeGreaterThan(0);
  });
});
