// RepoModel: turns per-file facts into graph edges. Follows import bindings through re-exports (`export *`,
// `export { x } from`, Python package re-exports, `__all__`) to the defining symbol, so "uses through a barrel" is a
// direct dependency on the defining file (ADR-0008, fixtures/README.md).
import { posix } from "node:path";
import type { FileFacts, ImportBinding, ImportFact } from "@catenet/parsers";
import { normalizePyName } from "../discover/packages.js";
import type { Confidence, EdgeKind, EdgeRecord, FileRecord, NodeKey, PackageInfo } from "../model.js";
import { PyResolver } from "./python.js";
import { exportTargets, type Resolution, TsResolver } from "./typescript.js";

export type Target =
  | { kind: "symbol"; path: string; name: string; subkind: string }
  | { kind: "module"; path: string };

interface ResolvedImport {
  fact: ImportFact;
  resolution: Resolution;
}

const isReexport = (i: ImportFact) => i.kind === "reexport" || i.kind === "reexport_all";
const symbolKey = (t: { path: string; name: string; subkind: string }): NodeKey => ({
  kind: "symbol",
  path: t.path,
  name: t.name,
  subkind: t.subkind,
});

export class RepoModel {
  readonly ts: TsResolver;
  readonly py: PyResolver;
  private readonly importCache = new Map<string, ResolvedImport[]>();
  private readonly nameCache = new Map<string, Target | null>();

  constructor(
    readonly files: Map<string, FileRecord>,
    readonly packages: PackageInfo[],
    allPaths: Set<string>,
    root: string,
  ) {
    this.ts = new TsResolver(root, allPaths, packages);
    this.py = new PyResolver(allPaths, packages);
  }

  private isPython(path: string): boolean {
    return this.files.get(path)?.lang === "python";
  }

  imports(path: string): ResolvedImport[] {
    const cached = this.importCache.get(path);
    if (cached) return cached;
    const rec = this.files.get(path);
    const out: ResolvedImport[] = [];
    for (const fact of rec?.facts.imports ?? []) {
      let resolution =
        rec?.lang === "python"
          ? this.py.resolve(path, fact.level, fact.module, fact.literal, fact.specifier)
          : this.ts.resolve(path, fact.specifier, fact.literal);
      // Resolution of a Python name to a file only counts for files we indexed (code files).
      if (resolution.kind === "file" && !this.files.has(resolution.path)) {
        resolution = { kind: "external", subkind: "unresolved", name: fact.specifier };
      }
      if (fact.kind === "importlib" && resolution.kind === "file")
        resolution = { ...resolution, confidence: "heuristic" };
      out.push({ fact, resolution });
    }
    this.importCache.set(path, out);
    return out;
  }

  /** Resolve an exported (TS) or importable (Python) name of a module to its definition. Cycle-safe. */
  resolveName(path: string, name: string, visiting = new Set<string>()): Target | null {
    const key = `${path}#${name}`;
    if (this.nameCache.has(key)) return this.nameCache.get(key) ?? null;
    if (visiting.has(key)) return null;
    visiting.add(key);
    const result = this.isPython(path)
      ? this.resolvePyName(path, name, visiting)
      : this.resolveTsName(path, name, visiting);
    visiting.delete(key);
    if (visiting.size === 0 || result) this.nameCache.set(key, result);
    return result;
  }

  private ownSymbol(facts: FileFacts, path: string, name: string): Target | null {
    const s = facts.symbols.find((x) => x.name === name && x.qualifiedName === name);
    return s ? { kind: "symbol", path, name: s.qualifiedName, subkind: s.subkind } : null;
  }

  private followBinding(imp: ResolvedImport, binding: ImportBinding, visiting: Set<string>): Target | null {
    if (imp.resolution.kind !== "file") return null;
    if (binding.imported === "*") return { kind: "module", path: imp.resolution.path };
    return this.resolveName(imp.resolution.path, binding.imported, visiting);
  }

  private resolveTsName(path: string, name: string, visiting: Set<string>): Target | null {
    const facts = this.files.get(path)?.facts;
    if (!facts) return null;
    const own = facts.symbols.find((s) => s.exportNames.includes(name));
    if (own) return { kind: "symbol", path, name: own.qualifiedName, subkind: own.subkind };
    const imports = this.imports(path);
    for (const le of facts.localExports) {
      if (le.exported !== name) continue;
      const local = this.ownSymbol(facts, path, le.local);
      if (local) return local;
      for (const imp of imports) {
        if (isReexport(imp.fact)) continue;
        const b = imp.fact.bindings.find((x) => x.local === le.local);
        if (b) return this.followBinding(imp, b, visiting);
      }
    }
    for (const imp of imports) {
      if (imp.fact.kind !== "reexport") continue;
      const b = imp.fact.bindings.find((x) => x.local === name);
      if (b) return this.followBinding(imp, b, visiting);
    }
    if (name === "default") return null;
    for (const imp of imports) {
      if (imp.fact.kind !== "reexport_all" || imp.resolution.kind !== "file") continue;
      const hit = this.resolveName(imp.resolution.path, name, visiting);
      if (hit) return hit;
    }
    return null;
  }

  private resolvePyName(path: string, name: string, visiting: Set<string>): Target | null {
    const facts = this.files.get(path)?.facts;
    if (!facts) return null;
    const own = this.ownSymbol(facts, path, name);
    if (own) return own;
    const imports = this.imports(path);
    for (const imp of imports) {
      const b = imp.fact.bindings.find((x) => x.local === name);
      if (!b || imp.resolution.kind !== "file") continue;
      if (b.imported === "*") return { kind: "module", path: imp.resolution.path };
      return this.resolvePyFromName(imp.resolution.path, b.imported, visiting);
    }
    for (const imp of imports) {
      if (!imp.fact.wildcard || imp.resolution.kind !== "file") continue;
      if (this.starNames(imp.resolution.path).includes(name))
        return this.resolveName(imp.resolution.path, name, visiting);
    }
    const sub = this.py.submodule(path, name);
    return sub && this.files.has(sub) ? { kind: "module", path: sub } : null;
  }

  /** `from <module file> import <name>`: a name in the module, or a submodule of a package. */
  private resolvePyFromName(modulePath: string, name: string, visiting: Set<string>): Target | null {
    return this.resolveName(modulePath, name, visiting);
  }

  /** Names bound by `from <path> import *`: `__all__`, else public top-level symbols and import bindings. */
  starNames(path: string): string[] {
    const facts = this.files.get(path)?.facts;
    if (!facts) return [];
    if (facts.dunderAll) return facts.dunderAll;
    const names = new Set<string>();
    for (const s of facts.symbols)
      if (s.qualifiedName === s.name && !s.name.startsWith("_")) names.add(s.name);
    for (const i of facts.imports)
      for (const b of i.bindings) if (!b.local.includes(".") && !b.local.startsWith("_")) names.add(b.local);
    return [...names];
  }

  /** Every name a TS module exports, including through `export *` chains (excluding `default` from those). */
  exportedNames(path: string, seen = new Set<string>()): string[] {
    if (seen.has(path)) return [];
    seen.add(path);
    const facts = this.files.get(path)?.facts;
    if (!facts) return [];
    if (this.isPython(path)) return this.starNames(path);
    const names = new Set<string>();
    for (const s of facts.symbols) for (const n of s.exportNames) names.add(n);
    for (const le of facts.localExports) names.add(le.exported);
    for (const imp of this.imports(path)) {
      if (imp.fact.kind === "reexport") for (const b of imp.fact.bindings) names.add(b.local);
      if (imp.fact.kind === "reexport_all" && imp.resolution.kind === "file") {
        for (const n of this.exportedNames(imp.resolution.path, seen)) if (n !== "default") names.add(n);
      }
    }
    return [...names].sort();
  }

  /** All edges whose source is this file or one of its symbols (`contains` edges are written by the indexer). */
  edgesFor(path: string): EdgeRecord[] {
    const rec = this.files.get(path);
    if (!rec) return [];
    const facts = rec.facts;
    const edges: EdgeRecord[] = [];
    const fileKey: NodeKey = { kind: "file", path };
    const depKind = (k: EdgeKind): EdgeKind => (rec.isTest ? "tests" : k);
    const subkindOf = new Map(facts.symbols.map((s) => [s.qualifiedName, s.subkind]));
    const srcFor = (enclosing: string | null): NodeKey => {
      const subkind = enclosing ? subkindOf.get(enclosing) : undefined;
      return enclosing && subkind ? { kind: "symbol", path, name: enclosing, subkind } : fileKey;
    };
    const toTarget = (
      t: Target | null,
      src: NodeKey,
      kind: EdgeKind,
      confidence: Confidence,
      line: number,
      extra = {},
    ) => {
      if (!t) return;
      const dst: NodeKey = t.kind === "symbol" ? symbolKey(t) : { kind: "file", path: t.path };
      const edgeKind = t.kind === "module" && kind !== "tests" ? "imports" : kind;
      edges.push({ src, dst, kind: depKind(edgeKind), confidence, attrs: { lines: [line], ...extra } });
    };

    const imports = this.imports(path);
    const bindings = new Map<string, { imp: ResolvedImport; binding: ImportBinding }>();
    for (const imp of imports) {
      const { fact, resolution } = imp;
      if (resolution.kind === "external") {
        const declared =
          resolution.subkind === "third_party" &&
          (rec.lang === "python"
            ? this.py.isDeclared(path, resolution.name)
            : this.isDeclaredNpm(path, resolution.name));
        edges.push({
          src: fileKey,
          dst: { kind: "external", subkind: resolution.subkind, name: resolution.name },
          kind: "depends_on",
          confidence: "exact",
          attrs: {
            lines: [fact.line],
            specifiers: [fact.specifier],
            ...(resolution.subkind === "third_party" ? { declared } : {}),
          },
        });
        continue;
      }
      const conf = resolution.confidence;
      edges.push({
        src: fileKey,
        dst: { kind: "file", path: resolution.path },
        kind: depKind("imports"),
        confidence: conf,
        attrs: { lines: [fact.line], importKinds: [fact.kind] },
      });
      if (fact.kind === "reexport_all") {
        for (const n of this.exportedNames(resolution.path)) {
          if (n !== "default")
            toTarget(this.resolveName(resolution.path, n), fileKey, "references", conf, fact.line, {
              reexport: true,
            });
        }
        continue;
      }
      for (const b of fact.bindings) {
        if (fact.kind !== "reexport") bindings.set(b.local, { imp, binding: b });
        if (b.imported === "*") continue;
        const target =
          rec.lang === "python"
            ? this.resolvePyFromName(resolution.path, b.imported, new Set())
            : this.resolveName(resolution.path, b.imported);
        const extra = fact.kind === "reexport" ? { reexport: true } : { binding: true };
        toTarget(target, fileKey, "references", conf, fact.line, extra);
      }
    }

    const wildcardModules = imports.filter((i) => i.fact.wildcard && i.resolution.kind === "file");
    const resolveUse = (
      local: string,
      member: string | undefined,
    ): { target: Target | null; confidence: Confidence } | null => {
      const bound = bindings.get(local);
      if (bound) {
        if (bound.imp.resolution.kind !== "file") return null;
        const conf = bound.imp.resolution.confidence;
        let target = this.followBinding(bound.imp, bound.binding, new Set());
        if (target?.kind === "module") {
          if (member) target = this.resolveName(target.path, member);
          // `const f = require("./m"); f()` uses CommonJS `module.exports`, i.e. the default export.
          else if (bound.imp.fact.kind === "require") target = this.resolveName(target.path, "default");
          else return null; // other whole-module uses: the file-level import edge already records them
        }
        return { target, confidence: conf };
      }
      for (const w of wildcardModules) {
        if (w.resolution.kind === "file" && this.starNames(w.resolution.path).includes(local)) {
          return { target: this.resolveName(w.resolution.path, local), confidence: w.resolution.confidence };
        }
      }
      return null;
    };

    for (const ref of facts.references) {
      const use = resolveUse(ref.local, ref.member);
      if (use)
        toTarget(
          use.target,
          srcFor(ref.enclosing),
          ref.isCall ? "calls" : "references",
          use.confidence,
          ref.line,
        );
    }
    for (const h of facts.heritage) {
      const use = resolveUse(h.base, h.member);
      const subkind = subkindOf.get(h.className);
      const src: NodeKey = subkind ? { kind: "symbol", path, name: h.className, subkind } : fileKey;
      if (use) toTarget(use.target, src, "inherits", use.confidence, h.line);
    }
    return edges;
  }

  private isDeclaredNpm(path: string, name: string): boolean {
    return this.packages.some(
      (p) =>
        p.manifest === "package.json" &&
        (p.path === "." || path.startsWith(`${p.path}/`)) &&
        p.dependencies.has(name),
    );
  }

  /** Symbols (and the files that define them) reachable from published packages' entry points (ADR-0008). */
  publishedApi(): { symbols: NodeKey[]; files: Set<string> } {
    const symbols = new Map<string, NodeKey>();
    const files = new Set<string>();
    const markModule = (path: string, seen: Set<string>) => {
      if (seen.has(path)) return;
      seen.add(path);
      for (const n of this.exportedNames(path)) mark(this.resolveName(path, n), seen);
    };
    const mark = (t: Target | null, seen: Set<string>) => {
      if (!t) return;
      if (t.kind === "module") return markModule(t.path, seen);
      const key = symbolKey(t);
      symbols.set(`${t.path}#${t.name}#${t.subkind}`, key);
      files.add(t.path);
    };
    for (const pkg of this.packages) {
      if (!pkg.published) continue;
      for (const entry of this.entryFiles(pkg)) markModule(entry, new Set());
    }
    return { symbols: [...symbols.values()], files };
  }

  private entryFiles(pkg: PackageInfo): string[] {
    if (pkg.manifest === "package.json") {
      const json = pkg.packageJson ?? {};
      const entries = new Set<string>();
      const subpaths =
        json.exports &&
        typeof json.exports === "object" &&
        !Array.isArray(json.exports) &&
        Object.keys(json.exports).some((k) => k.startsWith("."))
          ? Object.keys(json.exports as object)
          : ["."];
      for (const sub of subpaths) {
        if (sub.includes("*")) {
          for (const f of this.wildcardExportFiles(pkg, json.exports, sub)) entries.add(f);
          continue;
        }
        if (json.exports !== undefined) {
          for (const t of exportTargets(json.exports, sub)) {
            const hit = this.ts.probe(posix.normalize(posix.join(pkg.path, t)));
            if (hit) entries.add(hit);
          }
        }
        const res = this.ts.resolveWorkspace(pkg, sub);
        if (res?.kind === "file") entries.add(res.path);
      }
      return [...entries].filter((e) => this.files.has(e));
    }
    const normalized = normalizePyName(pkg.name).replace(/-/g, "_");
    const tops = new Set<string>();
    for (const f of this.files.keys()) {
      for (const root of [pkg.path, pkg.path === "." ? "src" : `${pkg.path}/src`]) {
        const prefix = root === "." ? "" : `${root}/`;
        if (!f.startsWith(prefix) || !f.endsWith("/__init__.py")) continue;
        const rel = f.slice(prefix.length).split("/");
        if (rel.length === 2 && rel[0]) tops.add(`${prefix}${rel[0]}/__init__.py`);
      }
    }
    const matching = [...tops].filter((t) => posix.basename(posix.dirname(t)) === normalized);
    return matching.length > 0 ? matching : tops.size === 1 ? [...tops] : [];
  }

  /** Files a wildcard subpath export (`"./utils/*": "./src/utils/*.ts"`) exposes: every repo file its targets match. */
  private wildcardExportFiles(pkg: PackageInfo, exportsField: unknown, subpath: string): string[] {
    const out = new Set<string>();
    const map = exportsField as Record<string, unknown>;
    for (const target of exportTargets({ ".": map[subpath] }, ".")) {
      const star = target.indexOf("*");
      if (star < 0) continue;
      // posix.normalize keeps a trailing slash, so "./src/utils/" stays a directory prefix.
      const prefix = posix.normalize(posix.join(pkg.path, target.slice(0, star))).replace(/^\.\//, "");
      const suffix = target.slice(star + 1);
      for (const f of this.files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        // Extensionless targets ("./src/utils/*") match any extension the resolver would probe.
        const matches = suffix
          ? rest.endsWith(suffix) && rest.length > suffix.length
          : this.ts.probe(f.replace(/\.[^./]+$/, "")) === f;
        if (matches) out.add(f);
      }
    }
    return [...out];
  }

  /** What other files can bind from this file. A change here means importers must be re-resolved. */
  static exportSurface(facts: FileFacts): string {
    if (facts.lang === "python") {
      return JSON.stringify({
        symbols: facts.symbols.filter((s) => s.qualifiedName === s.name).map((s) => [s.name, s.subkind]),
        all: facts.dunderAll,
        imports: facts.imports.map((i) => [i.specifier, i.level, i.module, i.bindings, i.wildcard]),
      });
    }
    return JSON.stringify({
      // All top-level symbols, not only directly exported ones: `export { x }` and `export default x` point at local
      // symbols, and an edge's destination identity includes the symbol's kind.
      symbols: facts.symbols
        .filter((s) => s.qualifiedName === s.name)
        .map((s) => [s.qualifiedName, s.subkind, s.exportNames]),
      localExports: facts.localExports.map((l) => [l.local, l.exported]),
      reexports: facts.imports.filter(isReexport).map((i) => [i.specifier, i.kind, i.bindings]),
      // Local exports can point at import bindings, so those bindings are part of the surface too.
      bindings: facts.imports.filter((i) => !isReexport(i)).map((i) => [i.specifier, i.bindings]),
    });
  }

  /** Whether `importer` re-exposes names it imports from `target` (so its own importers depend on `target`'s surface). */
  reexposes(importer: string, target: string): boolean {
    const rec = this.files.get(importer);
    if (!rec) return false;
    for (const imp of this.imports(importer)) {
      if (imp.resolution.kind !== "file" || imp.resolution.path !== target) continue;
      if (rec.lang === "python") {
        if (imp.fact.wildcard || imp.fact.bindings.some((b) => b.imported !== "*")) return true;
        continue;
      }
      if (isReexport(imp.fact)) return true;
      if (imp.fact.bindings.some((b) => rec.facts.localExports.some((le) => le.local === b.local)))
        return true;
    }
    return false;
  }
}
