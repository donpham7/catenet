// Python extraction. Node type names verified against web-tree-sitter 0.27 parse trees of fixtures/py-basic.
import type { Node } from "web-tree-sitter";
import type { FileFacts, HeritageFact, ImportBinding, ImportFact, ReferenceFact } from "./types.js";
import { countParseErrors, enclosingSymbol, lineOf, type RangedSymbol, unquote, walk } from "./util.js";

const IMPORTLIB_CALLS = new Set(["importlib.import_module", "import_module", "__import__"]);
const isDunder = (name: string) => name.startsWith("__") && name.endsWith("__");

function readDunderAll(root: Node): string[] | null {
  let result: string[] | null = null;
  for (const stmt of root.namedChildren) {
    const assign = stmt.type === "expression_statement" ? stmt.namedChildren[0] : null;
    if (assign?.type !== "assignment" || assign.childForFieldName("left")?.text !== "__all__") continue;
    const right = assign.childForFieldName("right");
    if (
      right &&
      (right.type === "list" || right.type === "tuple") &&
      right.namedChildren.every((c) => c.type === "string")
    ) {
      result = right.namedChildren.map((c) => unquote(c.text));
    } else result = null;
  }
  return result;
}

export function extractPython(root: Node): FileFacts {
  const dunderAll = readDunderAll(root);
  const exportNames = (name: string) => {
    if (dunderAll) return dunderAll.includes(name) ? [name] : [];
    return name.startsWith("_") ? [] : [name];
  };

  const symbols: RangedSymbol[] = [];
  const addSymbol = (
    name: string,
    qualifiedName: string,
    subkind: "function" | "class" | "method" | "variable",
    node: Node,
    exported: string[],
  ) => {
    symbols.push({
      fact: {
        name,
        qualifiedName,
        subkind,
        startLine: lineOf(node),
        endLine: node.endPosition.row + 1,
        exportNames: exported,
      },
      start: node.startIndex,
      end: node.endIndex,
    });
  };

  const declareDefinition = (outer: Node, def: Node, className: string | null) => {
    const name = def.childForFieldName("name")?.text;
    if (!name) return;
    if (def.type === "class_definition" && !className) {
      addSymbol(name, name, "class", outer, exportNames(name));
      for (const member of def.childForFieldName("body")?.namedChildren ?? []) {
        const inner =
          member.type === "decorated_definition" ? member.childForFieldName("definition") : member;
        if (inner?.type === "function_definition") declareDefinition(member, inner, name);
      }
    } else if (def.type === "function_definition") {
      if (className) addSymbol(name, `${className}.${name}`, "method", outer, []);
      else addSymbol(name, name, "function", outer, exportNames(name));
    }
  };

  for (const stmt of root.namedChildren) {
    const def = stmt.type === "decorated_definition" ? stmt.childForFieldName("definition") : stmt;
    if (def && (def.type === "function_definition" || def.type === "class_definition")) {
      declareDefinition(stmt, def, null);
      continue;
    }
    const assign = stmt.type === "expression_statement" ? stmt.namedChildren[0] : null;
    const left = assign?.type === "assignment" ? assign.childForFieldName("left") : null;
    if (left?.type === "identifier" && !isDunder(left.text))
      addSymbol(left.text, left.text, "variable", stmt, exportNames(left.text));
  }

  // Imports anywhere (top level, inside try/except, inside functions).
  const imports: ImportFact[] = [];
  walk(root, (n) => {
    if (n.type === "import_statement") {
      for (const name of n.childrenForFieldName("name")) {
        const dotted = name.type === "aliased_import" ? name.childForFieldName("name") : name;
        if (!dotted) continue;
        const alias = name.type === "aliased_import" ? name.childForFieldName("alias")?.text : undefined;
        imports.push({
          specifier: dotted.text,
          kind: "static",
          line: lineOf(n),
          literal: true,
          bindings: [{ imported: "*", local: alias ?? dotted.text }],
          wildcard: false,
          level: 0,
          module: dotted.text,
        });
      }
    } else if (n.type === "import_from_statement") {
      const moduleName = n.childForFieldName("module_name");
      if (!moduleName) return;
      let level = 0;
      let module = moduleName.text;
      if (moduleName.type === "relative_import") {
        level = moduleName.namedChildren.find((c) => c.type === "import_prefix")?.text.length ?? 0;
        module = moduleName.namedChildren.find((c) => c.type === "dotted_name")?.text ?? "";
      }
      const bindings: ImportBinding[] = [];
      for (const name of n.childrenForFieldName("name")) {
        if (name.type === "aliased_import") {
          const imported = name.childForFieldName("name")?.text;
          if (imported) bindings.push({ imported, local: name.childForFieldName("alias")?.text ?? imported });
        } else bindings.push({ imported: name.text, local: name.text });
      }
      imports.push({
        specifier: moduleName.text,
        kind: "static",
        line: lineOf(n),
        literal: true,
        bindings,
        wildcard: n.namedChildren.some((c) => c.type === "wildcard_import"),
        level,
        module,
      });
    } else if (n.type === "call") {
      const fn = n.childForFieldName("function");
      const arg = n.childForFieldName("arguments")?.namedChildren[0];
      if (!fn || !arg || !IMPORTLIB_CALLS.has(fn.text)) return;
      const literal = arg.type === "string" && !arg.namedChildren.some((c) => c.type === "interpolation");
      const specifier = arg.type === "string" ? unquote(arg.text) : arg.text;
      // `importlib.import_module(".mod", __package__)` is relative to the importing module's package.
      const level = literal ? (/^\.+/.exec(specifier)?.[0].length ?? 0) : 0;
      imports.push({
        specifier,
        kind: "importlib",
        line: lineOf(n),
        literal,
        bindings: [],
        wildcard: false,
        level,
        module: specifier.slice(level),
      });
    }
  });

  // References: uses of imported names. With a wildcard import, free names are recorded too; the resolver keeps only
  // those the star-imported module actually exports.
  const bound = new Set<string>();
  const dotted = new Set<string>();
  for (const imp of imports) {
    for (const b of imp.bindings) {
      bound.add(b.local);
      if (b.local.includes(".")) dotted.add(b.local);
    }
  }
  const hasWildcard = imports.some((i) => i.wildcard);
  const defined = new Set(symbols.map((s) => s.fact.name));
  const isCallee = (n: Node) =>
    n.parent?.type === "call" && (n.parent.childForFieldName("function")?.equals(n) ?? false);
  const isDeclarationName = (n: Node) => {
    const p = n.parent;
    if (!p) return false;
    const isNameField = p.childForFieldName("name")?.equals(n) ?? false;
    if (
      (p.type === "function_definition" || p.type === "class_definition" || p.type === "keyword_argument") &&
      isNameField
    ) {
      return true;
    }
    // Parameters: only the parameter's own name. Default values (`f=fmt`) and annotations are uses.
    if (p.type === "default_parameter" || p.type === "typed_default_parameter") return isNameField;
    if (p.type === "typed_parameter") return p.namedChildren[0]?.equals(n) ?? false;
    return (
      p.type === "parameters" ||
      p.type === "lambda_parameters" ||
      p.type === "list_splat_pattern" ||
      p.type === "dictionary_splat_pattern"
    );
  };

  const references: ReferenceFact[] = [];
  const heritage: HeritageFact[] = [];
  walk(
    root,
    (n) => {
      if (n.type === "class_definition") {
        const className = enclosingSymbol(symbols, n) ?? n.childForFieldName("name")?.text ?? "";
        for (const base of n.childForFieldName("superclasses")?.namedChildren ?? []) {
          if (base.type === "identifier") heritage.push({ className, base: base.text, line: lineOf(base) });
          else if (base.type === "attribute") {
            heritage.push({
              className,
              base: base.childForFieldName("object")?.text ?? "",
              member: base.childForFieldName("attribute")?.text ?? "",
              line: lineOf(base),
            });
          }
        }
        return;
      }
      if (n.type === "attribute") {
        const obj = n.childForFieldName("object");
        if (obj && (dotted.has(obj.text) || (obj.type === "identifier" && bound.has(obj.text)))) {
          const member = n.childForFieldName("attribute")?.text;
          if (member)
            references.push({
              local: obj.text,
              member,
              line: lineOf(n),
              enclosing: enclosingSymbol(symbols, n),
              isCall: isCallee(n),
            });
        }
        return;
      }
      if (n.type !== "identifier" || isDeclarationName(n)) return;
      const p = n.parent;
      if (p?.type === "attribute" && !p.childForFieldName("object")?.equals(n)) return; // attribute name, not a use
      if (p?.type === "attribute" && bound.has(n.text)) return; // handled at the attribute node
      if (bound.has(n.text) || (hasWildcard && !defined.has(n.text))) {
        references.push({
          local: n.text,
          line: lineOf(n),
          enclosing: enclosingSymbol(symbols, n),
          isCall: isCallee(n),
        });
      }
    },
    (n) =>
      n.type === "import_statement" ||
      n.type === "import_from_statement" ||
      n.type === "future_import_statement",
  );

  return {
    lang: "python",
    symbols: symbols.map((s) => s.fact),
    imports,
    references,
    heritage,
    localExports: [],
    dunderAll,
    parseErrors: countParseErrors(root),
  };
}
