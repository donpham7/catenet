// FileFacts: everything the indexer needs from one source file, with no filesystem access and no resolution.
// Specifiers stay exactly as written; @catenet/core resolves them to files, symbols or externals.

export type Lang = "typescript" | "tsx" | "javascript" | "python";

export type SymbolSubkind = "function" | "class" | "method" | "interface" | "type" | "enum" | "variable";

export interface SymbolFact {
  name: string;
  /** `Class.method` for methods, otherwise the name. Unique per file in practice; used for node identity. */
  qualifiedName: string;
  subkind: SymbolSubkind;
  startLine: number;
  endLine: number;
  /**
   * Names this symbol is exported under from this file. TS: its own name and/or "default".
   * Python: [name] when public (or listed in `__all__`). Empty when not exported.
   */
  exportNames: string[];
}

export type ImportKind =
  | "static" // import { a } from "m" / import a from "m" / import * as a from "m" / Python import & from-import
  | "type_only" // import type { A } from "m"
  | "side_effect" // import "m"
  | "reexport" // export { a as b } from "m"
  | "reexport_all" // export * from "m" (and export * as ns from "m")
  | "dynamic" // import("m")
  | "require" // require("m")
  | "importlib"; // importlib.import_module("m") / __import__("m")

export interface ImportBinding {
  /** Name exported by the source module: an identifier, "default", or "*" for the whole module (namespace). */
  imported: string;
  /** Name bound in this file. For re-exports, the name exported from this file. Dotted for `import a.b.c`. */
  local: string;
}

export interface ImportFact {
  /**
   * The module specifier as written, without surrounding quotes/backticks or a Python string prefix.
   * TS: "./lib", "@/lib/format", "./${name}". Python: "pybasic.core.money", "..core", ".", "pybasic.plugins.{name}".
   */
  specifier: string;
  kind: ImportKind;
  line: number;
  /** False for template literals with substitutions, f-strings and non-string arguments: never resolvable. */
  literal: boolean;
  bindings: ImportBinding[];
  /** Python `from m import *`. */
  wildcard: boolean;
  /** Python only: number of leading dots (0 = absolute). */
  level: number;
  /** Python only: dotted module path without the leading dots ("" for `from . import x`). */
  module: string;
}

export interface ReferenceFact {
  /** Local binding name that was used (a key into ImportFact.bindings[].local). */
  local: string;
  /** Member accessed on a namespace/module binding: `lib.formatCurrency` -> "formatCurrency". */
  member?: string;
  line: number;
  /** qualifiedName of the enclosing symbol, or null for top-level code. */
  enclosing: string | null;
  isCall: boolean;
}

export interface HeritageFact {
  /** qualifiedName of the class that extends. */
  className: string;
  /** Base class expression: identifier, or namespace + member. */
  base: string;
  member?: string;
  line: number;
}

/** TS `export { local as exported }` without a source module, and `export default <identifier>`. */
export interface LocalExportFact {
  local: string;
  exported: string;
  line: number;
}

export interface FileFacts {
  lang: Lang;
  symbols: SymbolFact[];
  imports: ImportFact[];
  references: ReferenceFact[];
  heritage: HeritageFact[];
  localExports: LocalExportFact[];
  /** Python `__all__` when it is a literal list/tuple of strings; null otherwise. */
  dunderAll: string[] | null;
  /** Number of ERROR/MISSING nodes. Non-zero means the grammar could not fully parse the file. */
  parseErrors: number;
}
