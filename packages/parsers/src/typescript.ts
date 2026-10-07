// TS/TSX/JS extraction. Node type names verified against web-tree-sitter 0.27 parse trees of fixtures/ts-basic.
import type { Node } from "web-tree-sitter";
import type {
  FileFacts,
  HeritageFact,
  ImportBinding,
  ImportFact,
  Lang,
  LocalExportFact,
  ReferenceFact,
  SymbolSubkind,
} from "./types.js";
import { countParseErrors, enclosingSymbol, lineOf, type RangedSymbol, unquote, walk } from "./util.js";

const DECLARATIONS: Record<string, SymbolSubkind> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  function_signature: "function",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};

const isImportCall = (value: Node | null): boolean => {
  const call = value?.type === "await_expression" ? value.namedChildren[0] : value;
  if (call?.type !== "call_expression") return false;
  const fn = call.childForFieldName("function");
  return fn?.type === "import" || (fn?.type === "identifier" && fn.text === "require");
};

const hasToken = (n: Node, token: string) => n.children.some((c) => !c.isNamed && c.type === token);

function importFact(
  specifier: string,
  kind: ImportFact["kind"],
  line: number,
  literal = true,
  bindings: ImportBinding[] = [],
): ImportFact {
  return { specifier, kind, line, literal, bindings, wildcard: false, level: 0, module: "" };
}

export function extractTypeScript(root: Node, lang: Lang): FileFacts {
  const symbols: RangedSymbol[] = [];
  const imports: ImportFact[] = [];
  const references: ReferenceFact[] = [];
  const heritage: HeritageFact[] = [];
  const localExports: LocalExportFact[] = [];
  /** Identifier nodes that declare a binding (require targets), so they are not counted as uses. */
  const bindingDecls = new Set<number>();

  const addSymbol = (
    name: string,
    qualifiedName: string,
    subkind: SymbolSubkind,
    node: Node,
    exportNames: string[],
  ) => {
    symbols.push({
      fact: {
        name,
        qualifiedName,
        subkind,
        startLine: lineOf(node),
        endLine: node.endPosition.row + 1,
        exportNames,
      },
      start: node.startIndex,
      end: node.endIndex,
    });
  };

  const declare = (decl: Node, exportNames: (name: string) => string[]) => {
    if (decl.type === "ambient_declaration") {
      for (const c of decl.namedChildren) declare(c, exportNames);
      return;
    }
    const subkind = DECLARATIONS[decl.type];
    if (subkind) {
      const name = decl.childForFieldName("name")?.text ?? "default";
      addSymbol(name, name, subkind, decl, exportNames(name));
      if (subkind === "class") declareMethods(decl, name);
      return;
    }
    if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
      for (const d of decl.namedChildren) {
        const nameNode = d.type === "variable_declarator" ? d.childForFieldName("name") : null;
        // `const x = require("m")` / `const x = await import("m")` bind an import; they define nothing.
        if (nameNode?.type === "identifier" && !isImportCall(d.childForFieldName("value")))
          addSymbol(nameNode.text, nameNode.text, "variable", d, exportNames(nameNode.text));
      }
    }
  };

  // CommonJS: `module.exports = x` is the default export; `exports.x = ...` / `module.exports.x = ...` export `x`.
  const cjsExportName = (left: Node): string | null => {
    if (left.type !== "member_expression") return null;
    if (left.text === "module.exports") return "default";
    const object = left.childForFieldName("object")?.text;
    return object === "exports" || object === "module.exports"
      ? (left.childForFieldName("property")?.text ?? null)
      : null;
  };

  const exportValue = (exported: string, value: Node, rangeNode: Node, line: number) => {
    if (value.type === "identifier") {
      localExports.push({ local: value.text, exported, line });
      return;
    }
    const isClass = value.type === "class";
    const isFunction = ["function_expression", "function", "arrow_function", "generator_function"].includes(
      value.type,
    );
    const own = value.childForFieldName("name")?.text;
    const name = exported === "default" ? (own ?? "default") : exported;
    addSymbol(name, name, isClass ? "class" : isFunction ? "function" : "variable", rangeNode, [exported]);
    if (isClass) declareMethods(value, name);
  };

  const commonJsExport = (assign: Node, line: number) => {
    const left = assign.childForFieldName("left");
    const right = assign.childForFieldName("right");
    const exported = left ? cjsExportName(left) : null;
    if (!right || exported === null) return;
    if (exported !== "default" || right.type !== "object") {
      exportValue(exported, right, right, line);
      return;
    }
    for (const prop of right.namedChildren) {
      if (prop.type === "shorthand_property_identifier")
        localExports.push({ local: prop.text, exported: prop.text, line });
      else if (prop.type === "pair") {
        const key = prop.childForFieldName("key");
        const value = prop.childForFieldName("value");
        if (key && value) exportValue(unquote(key.text), value, prop, line);
      } else if (prop.type === "method_definition") {
        const name = prop.childForFieldName("name")?.text;
        if (name) addSymbol(name, name, "function", prop, [name]);
      }
    }
  };

  const declareMethods = (classNode: Node, className: string) => {
    const body = classNode.childForFieldName("body");
    for (const m of body?.namedChildren ?? []) {
      if (
        m.type === "method_definition" ||
        m.type === "method_signature" ||
        m.type === "abstract_method_signature"
      ) {
        const name = m.childForFieldName("name")?.text;
        if (name) addSymbol(name, `${className}.${name}`, "method", m, []);
      }
    }
  };

  // Pass 1: top-level statements (imports, re-exports, declarations, local exports).
  for (const stmt of root.namedChildren) {
    const line = lineOf(stmt);
    if (stmt.type === "import_statement") {
      const source = stmt.childForFieldName("source");
      if (!source) continue;
      const clause = stmt.namedChildren.find((c) => c.type === "import_clause");
      if (!clause) {
        imports.push(importFact(unquote(source.text), "side_effect", line));
        continue;
      }
      const bindings: ImportBinding[] = [];
      for (const c of clause.namedChildren) {
        if (c.type === "identifier") bindings.push({ imported: "default", local: c.text });
        else if (c.type === "namespace_import") {
          const id = c.namedChildren.find((x) => x.type === "identifier");
          if (id) bindings.push({ imported: "*", local: id.text });
        } else if (c.type === "named_imports") {
          for (const spec of c.namedChildren) {
            if (spec.type !== "import_specifier") continue;
            const name = spec.childForFieldName("name")?.text;
            if (name) bindings.push({ imported: name, local: spec.childForFieldName("alias")?.text ?? name });
          }
        }
      }
      imports.push(
        importFact(
          unquote(source.text),
          hasToken(stmt, "type") ? "type_only" : "static",
          line,
          true,
          bindings,
        ),
      );
      continue;
    }

    if (stmt.type === "export_statement") {
      const source = stmt.childForFieldName("source");
      const clause = stmt.namedChildren.find((c) => c.type === "export_clause");
      if (source) {
        const spec = unquote(source.text);
        const ns = stmt.namedChildren.find((c) => c.type === "namespace_export");
        if (clause) {
          const bindings = clause.namedChildren
            .filter((s) => s.type === "export_specifier")
            .map((s) => {
              const name = s.childForFieldName("name")?.text ?? "";
              return { imported: name, local: s.childForFieldName("alias")?.text ?? name };
            });
          imports.push(importFact(spec, "reexport", line, true, bindings));
        } else if (ns) {
          const id = ns.namedChildren.find((x) => x.type === "identifier" || x.type === "string");
          imports.push(
            importFact(spec, "reexport", line, true, [{ imported: "*", local: id ? unquote(id.text) : "*" }]),
          );
        } else {
          imports.push(importFact(spec, "reexport_all", line));
        }
        continue;
      }
      const isDefault = hasToken(stmt, "default");
      const decl = stmt.childForFieldName("declaration");
      if (decl) {
        declare(decl, (name) => (isDefault ? ["default"] : [name]));
        continue;
      }
      if (clause) {
        for (const s of clause.namedChildren) {
          if (s.type !== "export_specifier") continue;
          const name = s.childForFieldName("name")?.text ?? "";
          localExports.push({ local: name, exported: s.childForFieldName("alias")?.text ?? name, line });
        }
        continue;
      }
      const value = stmt.childForFieldName("value");
      if (isDefault && value) {
        if (value.type === "identifier") localExports.push({ local: value.text, exported: "default", line });
        else {
          const named = value.childForFieldName("name")?.text;
          const subkind: SymbolSubkind = value.type.includes("class")
            ? "class"
            : value.type.includes("function")
              ? "function"
              : "variable";
          addSymbol(named ?? "default", named ?? "default", subkind, value, ["default"]);
        }
      }
      continue;
    }

    if (stmt.type === "expression_statement") {
      const assign = stmt.namedChildren[0];
      if (assign?.type === "assignment_expression") commonJsExport(assign, line);
      continue;
    }

    declare(stmt, () => []);
  }

  // Pass 2: dynamic imports and require() anywhere in the file.
  walk(root, (n) => {
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const arg = n.childForFieldName("arguments")?.namedChildren[0];
    if (!fn || !arg) return;
    if (fn.type === "import") {
      const literal =
        arg.type === "string" ||
        (arg.type === "template_string" &&
          !arg.namedChildren.some((c) => c.type === "template_substitution"));
      imports.push(importFact(unquote(arg.text), "dynamic", lineOf(n), literal));
    } else if (fn.type === "identifier" && fn.text === "require") {
      // Like import(): a template with substitutions or a non-string argument is kept as an unresolvable import.
      const literal =
        arg.type === "string" ||
        (arg.type === "template_string" &&
          !arg.namedChildren.some((c) => c.type === "template_substitution"));
      const bindings: ImportBinding[] = [];
      const parent = n.parent;
      const target =
        parent?.type === "variable_declarator" && parent.childForFieldName("value")?.equals(n)
          ? parent.childForFieldName("name")
          : null;
      if (target?.type === "identifier") {
        bindings.push({ imported: "*", local: target.text });
        bindingDecls.add(target.startIndex);
      } else if (target?.type === "object_pattern") {
        for (const p of target.namedChildren) {
          if (p.type === "shorthand_property_identifier_pattern")
            bindings.push({ imported: p.text, local: p.text });
          else if (p.type === "pair_pattern") {
            const key = p.childForFieldName("key")?.text;
            const value = p.childForFieldName("value");
            if (key && value?.type === "identifier") bindings.push({ imported: key, local: value.text });
          }
        }
      }
      imports.push(importFact(unquote(arg.text), "require", lineOf(n), literal, bindings));
    }
  });

  // Pass 3: uses of imported bindings, and class heritage.
  const bindingKinds = new Map<string, "namespace" | "named">();
  for (const imp of imports) {
    if (imp.kind === "reexport" || imp.kind === "reexport_all") continue;
    for (const b of imp.bindings) bindingKinds.set(b.local, b.imported === "*" ? "namespace" : "named");
  }
  const isCallee = (n: Node) => {
    const p = n.parent;
    if (!p) return false;
    if (p.type === "call_expression") return p.childForFieldName("function")?.equals(n) ?? false;
    if (p.type === "new_expression") return p.childForFieldName("constructor")?.equals(n) ?? false;
    return false;
  };
  const skipSubtree = (n: Node) =>
    n.type === "import_statement" ||
    n.type === "export_clause" ||
    (n.type === "export_statement" && n.childForFieldName("source") !== null);

  walk(
    root,
    (n) => {
      if (n.type === "class_heritage") {
        const cls = n.parent;
        const className = cls?.childForFieldName("name")?.text;
        const ext = n.namedChildren.find((c) => c.type === "extends_clause");
        const value = ext?.childForFieldName("value") ?? ext?.namedChildren[0];
        if (className && value) {
          const qualified = enclosingSymbol(symbols, n) ?? className;
          if (value.type === "member_expression") {
            heritage.push({
              className: qualified,
              base: value.childForFieldName("object")?.text ?? value.text,
              member: value.childForFieldName("property")?.text ?? "",
              line: lineOf(value),
            });
          } else heritage.push({ className: qualified, base: value.text, line: lineOf(value) });
        }
        return;
      }
      const isId =
        n.type === "identifier" || n.type === "type_identifier" || n.type === "shorthand_property_identifier";
      if (!isId || bindingDecls.has(n.startIndex)) return;
      const kind = bindingKinds.get(n.text);
      if (!kind) return;
      const parent = n.parent;
      // Member access is recorded for every binding (default imports are often used like namespaces, e.g. lodash);
      // the resolver only follows `member` for namespace bindings.
      if (parent && (parent.type === "member_expression" || parent.type === "nested_type_identifier")) {
        const isObject =
          parent.type === "member_expression"
            ? parent.childForFieldName("object")?.equals(n)
            : parent.namedChildren[0]?.equals(n);
        if (isObject) {
          const member =
            parent.type === "member_expression"
              ? parent.childForFieldName("property")?.text
              : parent.namedChildren[1]?.text;
          if (member) {
            references.push({
              local: n.text,
              member,
              line: lineOf(n),
              enclosing: enclosingSymbol(symbols, n),
              isCall: isCallee(parent),
            });
            return;
          }
        }
      }
      references.push({
        local: n.text,
        line: lineOf(n),
        enclosing: enclosingSymbol(symbols, n),
        isCall: isCallee(n),
      });
    },
    skipSubtree,
  );

  return {
    lang,
    symbols: symbols.map((s) => s.fact),
    imports,
    references,
    heritage,
    localExports,
    dunderAll: null,
    parseErrors: countParseErrors(root),
  };
}
