// Read-only queries over graph.db (ARCHITECTURE 2.3, ADR-0008). Every result carries the facts that justify it.
import { posix } from "node:path";
import type { Confidence } from "../model.js";
import {
  type DependentRow,
  type EvidenceRow,
  type NodeRow,
  SqliteGraphStore,
} from "../store/sqlite-store.js";

export interface Dependent {
  file: string;
  confidence: Confidence;
}

export interface DependentsResult {
  target: ResolvedTarget;
  direct: Dependent[];
  transitive: Dependent[];
}

export interface ResolvedTarget {
  /** Canonical form: `path` or `path#QualifiedName`. */
  id: string;
  path: string;
  symbol: string | null;
  nodeIds: number[];
}

export interface Impact {
  target: ResolvedTarget;
  direct: Dependent[];
  transitive: Dependent[];
  /** Packages containing the target or any transitive dependent. */
  packages: string[];
  /** Packages other than the target's own. */
  crossPackage: string[];
  tests: { kind: "static"; covered: string[]; uncovered: string[]; targetCovered: boolean };
  publishedApi: boolean;
  /** Unresolved import sites in the target's package; any of them may hide dependents. */
  unresolvedImports: { from: string; specifier: string; lines: number[] }[];
  evidence: { file: string; edges: EvidenceRow[] }[];
}

export class TargetError extends Error {
  constructor(
    message: string,
    readonly candidates: string[] = [],
  ) {
    super(message);
  }
}

const best = (a: Confidence, b: Confidence): Confidence =>
  a === "exact" || b === "exact" ? "exact" : "heuristic";
const sortDeps = (m: Map<string, Confidence>): Dependent[] =>
  [...m.entries()]
    .map(([file, confidence]) => ({ file, confidence }))
    .sort((a, b) => a.file.localeCompare(b.file));
const attrs = (r: NodeRow): Record<string, unknown> =>
  r.attrs ? (JSON.parse(r.attrs) as Record<string, unknown>) : {};

export class Graph {
  private readonly store: SqliteGraphStore;

  constructor(dbPath: string) {
    this.store = new SqliteGraphStore(dbPath);
  }

  close(): void {
    this.store.close();
  }

  /** Accepts `path`, `path#Symbol` (qualified or short name) or a bare symbol name. */
  resolveTarget(spec: string): ResolvedTarget {
    const hash = spec.indexOf("#");
    const rawPath = hash >= 0 ? spec.slice(0, hash) : spec;
    const path = posix.normalize(rawPath).replace(/^\.\//, "");
    const symbol = hash >= 0 ? spec.slice(hash + 1) : null;
    const file = this.store.fileNode(path);
    if (file) {
      const symbols = this.store.symbolsOf(path);
      if (symbol === null)
        return { id: path, path, symbol: null, nodeIds: [file.id, ...symbols.map((s) => s.id)] };
      const matches = symbols.filter((s) => s.name === symbol || s.name.endsWith(`.${symbol}`));
      const exact = matches.filter((s) => s.name === symbol);
      const chosen = exact.length > 0 ? exact : matches;
      const names = [...new Set(chosen.map((s) => s.name))].sort();
      if (names.length > 1) {
        throw new TargetError(
          `"${symbol}" is ambiguous in ${path}`,
          names.map((n) => `${path}#${n}`),
        );
      }
      if (chosen.length === 0)
        throw new TargetError(
          `no symbol "${symbol}" in ${path}`,
          symbols.map((s) => `${path}#${s.name}`),
        );
      const name = chosen[0]?.name ?? symbol;
      return { id: `${path}#${name}`, path, symbol: name, nodeIds: chosen.map((s) => s.id) };
    }
    if (hash < 0) {
      const found = this.store.findSymbols(spec);
      const ids = [...new Set(found.map((s) => `${s.path}#${s.name}`))];
      if (ids.length === 1 && found[0]?.path) {
        return {
          id: ids[0] as string,
          path: found[0].path,
          symbol: found[0].name,
          nodeIds: found.map((s) => s.id),
        };
      }
      if (ids.length > 1) throw new TargetError(`"${spec}" is ambiguous`, ids);
    }
    throw new TargetError(
      `not indexed: ${spec} (run \`catenet index\`, or check the path is a TS/JS/Python file)`,
    );
  }

  dependents(spec: string, opts: { depth?: number } = {}): DependentsResult {
    const target = this.resolveTarget(spec);
    const direct = new Map<string, Confidence>();
    for (const r of this.store.directDependents(target.nodeIds, target.path))
      direct.set(r.path, r.confidence);
    const transitive = this.closure(direct, target.path, opts.depth, (p) => this.store.reverseFileDeps(p));
    return { target, direct: sortDeps(direct), transitive: sortDeps(transitive) };
  }

  dependencies(spec: string, opts: { depth?: number } = {}): DependentsResult {
    const target = this.resolveTarget(spec);
    const direct = new Map<string, Confidence>();
    for (const r of this.store.directDependencies(target.nodeIds, target.path))
      direct.set(r.path, r.confidence);
    const transitive = this.closure(direct, target.path, opts.depth, (p) => this.store.forwardFileDeps(p));
    return { target, direct: sortDeps(direct), transitive: sortDeps(transitive) };
  }

  /** Breadth-first closure from the direct set; confidence is exact only along an all-exact path. Cycle-safe. */
  private closure(
    direct: Map<string, Confidence>,
    exclude: string,
    depth: number | undefined,
    next: (path: string) => DependentRow[],
  ): Map<string, Confidence> {
    const seen = new Map(direct);
    let frontier = [...direct.keys()];
    for (let level = 1; frontier.length > 0 && (depth === undefined || level < depth); level++) {
      const nextFrontier: string[] = [];
      for (const path of frontier) {
        const via = seen.get(path) as Confidence;
        for (const n of next(path)) {
          if (n.path === exclude) continue;
          const conf: Confidence = via === "exact" && n.confidence === "exact" ? "exact" : "heuristic";
          const prev = seen.get(n.path);
          if (prev === undefined || (prev === "heuristic" && conf === "exact")) {
            seen.set(n.path, prev ? best(prev, conf) : conf);
            nextFrontier.push(n.path);
          }
        }
      }
      frontier = nextFrontier;
    }
    return seen;
  }

  impact(spec: string): Impact {
    const { target, direct, transitive } = this.dependents(spec);
    const tested = this.store.testedPaths();
    const testedIds = this.store.testedNodeIds();
    const covered = transitive.filter((d) => tested.has(d.file)).map((d) => d.file);
    const uncovered = transitive.filter((d) => !tested.has(d.file)).map((d) => d.file);
    const targetCovered =
      target.symbol === null ? tested.has(target.path) : target.nodeIds.some((id) => testedIds.has(id));

    const ownPackage = this.store.packageOfFile(target.path) ?? null;
    const packages = new Set<string>();
    if (ownPackage) packages.add(ownPackage);
    for (const d of transitive) {
      const p = this.store.packageOfFile(d.file);
      if (p) packages.add(p);
    }

    const rows =
      target.symbol === null ? [this.store.fileNode(target.path), ...this.store.symbolsOf(target.path)] : [];
    const publishedApi =
      target.symbol === null
        ? rows.some((r) => r !== undefined && attrs(r).published_api === true)
        : this.store
            .symbolsOf(target.path)
            .some((s) => target.nodeIds.includes(s.id) && attrs(s).published_api === true);

    const unresolvedImports = this.store
      .externals()
      .filter(
        (e) =>
          e.subkind === "unresolved" &&
          (ownPackage === null || this.store.packageOfFile(e.from) === ownPackage),
      )
      .map(({ from, specifier, lines }) => ({ from, specifier, lines }));

    return {
      target,
      direct,
      transitive,
      packages: [...packages].sort(),
      crossPackage: [...packages].filter((p) => p !== ownPackage).sort(),
      tests: { kind: "static", covered, uncovered, targetCovered },
      publishedApi,
      unresolvedImports,
      evidence: direct.map((d) => ({
        file: d.file,
        edges: this.store.evidence(target.nodeIds, d.file).slice(0, 3),
      })),
    };
  }

  findSymbols(name: string): { id: string; subkind: string | null; line: number | null }[] {
    return this.store
      .findSymbols(name)
      .map((s) => ({ id: `${s.path}#${s.name}`, subkind: s.subkind, line: s.start_line }));
  }

  packages(): { path: string; name: string; published: boolean }[] {
    return this.store.packages().map(({ path, name, published }) => ({ path, name, published }));
  }

  externals(): { from: string; specifier: string; subkind: string }[] {
    return this.store.externals().map(({ from, specifier, subkind }) => ({ from, specifier, subkind }));
  }

  /** Deterministic dump of the derived graph (tests compare incremental and full indexing with it). */
  dump(): ReturnType<SqliteGraphStore["dump"]> {
    return this.store.dump();
  }
}

export function openGraph(dbPath: string): Graph {
  return new Graph(dbPath);
}
