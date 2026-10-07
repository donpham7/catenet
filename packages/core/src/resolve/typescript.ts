// TS/JS module resolution (ADR-0013 / ARCHITECTURE 2.1). Maps a specifier to a repo file or an external.
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import type { Confidence, ExternalSubkind, PackageInfo } from "../model.js";

export type Resolution =
  | { kind: "file"; path: string; confidence: Confidence }
  | { kind: "external"; subkind: ExternalSubkind; name: string };

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS: [string, string[]][] = [
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
];
const CONDITIONS = ["import", "default", "require", "node", "types"];
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "")));

/** Strip // and /* comments and trailing commas so tsconfig.json (JSONC) parses with JSON.parse. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

interface TsConfig {
  dir: string;
  baseUrl: string | null;
  paths: [string, string[]][];
}

/** Match a single-`*` pattern; returns the captured star text, or null. */
function matchStar(pattern: string, value: string): string | null {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === value ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (value.length < prefix.length + suffix.length || !value.startsWith(prefix) || !value.endsWith(suffix))
    return null;
  return value.slice(prefix.length, value.length - suffix.length);
}

export class TsResolver {
  private readonly tsconfigs = new Map<string, TsConfig | null>();
  private readonly workspace = new Map<string, PackageInfo>();
  /** Every dependency name declared by some package.json in the repo. */
  private readonly declaredPackages = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly files: Set<string>,
    packages: PackageInfo[],
  ) {
    for (const p of packages) {
      if (p.manifest !== "package.json") continue;
      this.workspace.set(p.name, p);
      for (const d of p.dependencies) this.declaredPackages.add(d);
    }
  }

  resolve(from: string, specifier: string, literal: boolean): Resolution {
    if (!literal) return { kind: "external", subkind: "unresolved", name: specifier };
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const base = specifier.startsWith("/")
        ? specifier.slice(1)
        : posix.join(posix.dirname(from), specifier);
      const hit = this.probe(posix.normalize(base));
      return hit
        ? { kind: "file", path: hit, confidence: "exact" }
        : { kind: "external", subkind: "unresolved", name: specifier };
    }
    const aliased = this.resolveTsconfigPath(from, specifier);
    if (aliased && aliased !== "aliasMiss") return aliased;
    if (specifier.startsWith("node:") || BUILTINS.has(specifier.split("/")[0] ?? "")) {
      return { kind: "external", subkind: "builtin", name: specifier.replace(/^node:/, "") };
    }
    const segments = specifier.split("/");
    const name = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier);
    const subpath = segments.slice(specifier.startsWith("@") ? 2 : 1).join("/");
    const ws = this.workspace.get(name);
    if (ws) {
      const hit = this.resolveWorkspace(ws, subpath ? `./${subpath}` : ".");
      return hit ?? { kind: "external", subkind: "unresolved", name: specifier };
    }
    // A specifier that matched a tsconfig alias but resolves nowhere, and that no package.json declares, is a broken
    // local alias rather than a third-party package.
    if (aliased === "aliasMiss" && !this.declaredPackages.has(name)) {
      return { kind: "external", subkind: "unresolved", name: specifier };
    }
    return { kind: "external", subkind: "third_party", name };
  }

  /** Probe a repo-relative path without extension guessing beyond TS/JS conventions. */
  probe(base: string): string | null {
    const norm = base.replace(/^\.\//, "");
    // Like TypeScript: "./util.js" means the util.ts source when it exists, even if util.js exists too.
    for (const [js, tsExts] of JS_TO_TS) {
      if (norm.endsWith(js)) {
        for (const ts of tsExts) {
          const candidate = norm.slice(0, -js.length) + ts;
          if (this.files.has(candidate)) return candidate;
        }
      }
    }
    if (this.files.has(norm) && /\.[cm]?[jt]sx?$/.test(norm)) return norm;
    for (const ext of EXTENSIONS) if (this.files.has(norm + ext)) return norm + ext;
    for (const ext of EXTENSIONS) {
      const candidate = norm === "" || norm === "." ? `index${ext}` : `${norm}/index${ext}`;
      if (this.files.has(candidate)) return candidate;
    }
    return null;
  }

  /** Resolve a workspace package subpath via `exports`, then `main`/`types`, then the directory itself. */
  resolveWorkspace(pkg: PackageInfo, subpath: string): Resolution | null {
    const json = pkg.packageJson ?? {};
    const candidates: string[] = [];
    if (json.exports !== undefined) candidates.push(...exportTargets(json.exports, subpath));
    else if (subpath === ".") {
      for (const field of ["module", "main", "types", "typings"])
        if (typeof json[field] === "string") candidates.push(json[field] as string);
    } else candidates.push(subpath);
    const join = (c: string) => posix.normalize(posix.join(pkg.path, c));
    for (const c of candidates) {
      const hit = this.probe(join(c));
      if (hit) return { kind: "file", path: hit, confidence: "exact" };
    }
    // Built output is usually absent from the repo: map dist/ (or build/, lib/, out/) back to src/ (heuristic).
    for (const c of candidates) {
      const mapped = c
        .replace(/^\.?\/?(dist|build|lib|out)\//, "./src/")
        .replace(/(\.d)?\.[cm]?js$|\.d\.ts$/, "");
      if (mapped === c) continue;
      const hit = this.probe(join(mapped));
      if (hit) return { kind: "file", path: hit, confidence: "heuristic" };
    }
    if (subpath === ".") {
      const hit = this.probe(join("index")) ?? this.probe(join("src/index"));
      if (hit) return { kind: "file", path: hit, confidence: "heuristic" };
    }
    return null;
  }

  /**
   * TypeScript semantics: an exact pattern wins, otherwise the pattern with the longest prefix before `*`. If its
   * targets resolve to no repo file, resolution continues normally (so `"*": ["types/*"]` doesn't swallow `react`).
   * Returns `aliasMiss` when a pattern matched but found nothing, so the caller can flag undeclared fallbacks.
   */
  private resolveTsconfigPath(from: string, specifier: string): Resolution | "aliasMiss" | null {
    const cfg = this.tsconfigFor(posix.dirname(from));
    if (!cfg) return null;
    let best: { targets: string[]; star: string; rank: number } | null = null;
    for (const [pattern, targets] of cfg.paths) {
      const star = matchStar(pattern, specifier);
      if (star === null) continue;
      const rank = pattern.includes("*") ? pattern.indexOf("*") : Number.MAX_SAFE_INTEGER;
      if (!best || rank > best.rank) best = { targets, star, rank };
    }
    if (best) {
      for (const t of best.targets) {
        const hit = this.probe(posix.normalize(t.replace("*", best.star)));
        if (hit) return { kind: "file", path: hit, confidence: "exact" };
      }
    }
    if (cfg.baseUrl !== null) {
      const hit = this.probe(posix.normalize(posix.join(cfg.baseUrl, specifier)));
      if (hit) return { kind: "file", path: hit, confidence: "exact" };
    }
    return best ? "aliasMiss" : null;
  }

  private tsconfigFor(dir: string): TsConfig | null {
    const cached = this.tsconfigs.get(dir);
    if (cached !== undefined) return cached;
    const rel = dir === "." ? "tsconfig.json" : `${dir}/tsconfig.json`;
    let cfg: TsConfig | null;
    if (this.files.has(rel)) cfg = this.loadTsconfig(rel, new Set());
    else cfg = dir === "." || dir === "" ? null : this.tsconfigFor(posix.dirname(dir));
    this.tsconfigs.set(dir, cfg);
    return cfg;
  }

  private loadTsconfig(rel: string, seen: Set<string>): TsConfig | null {
    if (seen.has(rel)) return null;
    seen.add(rel);
    let json: { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } };
    try {
      json = parseJsonc(readFileSync(join(this.root, rel), "utf8")) as typeof json;
    } catch {
      return null;
    }
    const dir = posix.dirname(rel);
    let base: TsConfig | null = null;
    if (typeof json.extends === "string" && json.extends.startsWith(".")) {
      const parentRel = posix.normalize(
        posix.join(dir, json.extends.endsWith(".json") ? json.extends : `${json.extends}.json`),
      );
      base = this.loadTsconfig(parentRel, seen);
    }
    const opts = json.compilerOptions ?? {};
    const baseUrl =
      typeof opts.baseUrl === "string"
        ? posix.normalize(posix.join(dir, opts.baseUrl))
        : (base?.baseUrl ?? null);
    const ownPaths =
      opts.paths && typeof opts.paths === "object"
        ? Object.entries(opts.paths as Record<string, string[]>).map(([k, v]): [string, string[]] => [
            k,
            // Targets are relative to baseUrl when set, otherwise to this tsconfig's directory; resolve them once here.
            v.map((t) => posix.join(baseUrl ?? dir, t)),
          ])
        : null;
    return { dir: baseUrl ?? dir, baseUrl, paths: ownPaths ?? base?.paths ?? [] };
  }
}

/**
 * Every tsconfig file and every file reachable through relative `extends` (string or array, any file name). Their
 * contents decide alias resolution, so the indexer treats them all as config.
 */
export function tsconfigChainFiles(root: string, files: string[]): string[] {
  const all = new Set(files);
  const out = new Set<string>();
  const stack = files.filter((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f));
  while (stack.length > 0) {
    const rel = stack.pop() as string;
    if (out.has(rel) || !all.has(rel)) continue;
    out.add(rel);
    let json: { extends?: unknown };
    try {
      json = parseJsonc(readFileSync(join(root, rel), "utf8")) as { extends?: unknown };
    } catch {
      continue;
    }
    const targets = Array.isArray(json.extends) ? json.extends : [json.extends];
    for (const t of targets) {
      if (typeof t !== "string" || !t.startsWith(".")) continue;
      stack.push(posix.normalize(posix.join(posix.dirname(rel), t.endsWith(".json") ? t : `${t}.json`)));
    }
  }
  return [...out].sort();
}

/** All string targets for a subpath of an `exports` field, in condition preference order. */
export function exportTargets(exportsField: unknown, subpath: string): string[] {
  const isSubpathMap = (o: object) => Object.keys(o).some((k) => k.startsWith("."));
  if (typeof exportsField === "string" || Array.isArray(exportsField))
    return subpath === "." ? flatten(exportsField) : [];
  if (!exportsField || typeof exportsField !== "object") return [];
  if (!isSubpathMap(exportsField)) return subpath === "." ? flatten(exportsField) : [];
  const map = exportsField as Record<string, unknown>;
  if (subpath in map) return flatten(map[subpath]);
  for (const [pattern, target] of Object.entries(map)) {
    const star = matchStar(pattern, subpath);
    if (star !== null && pattern.includes("*")) return flatten(target).map((t) => t.replace("*", star));
  }
  return [];
}

function flatten(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const ordered = [
      ...CONDITIONS.filter((c) => c in obj),
      ...Object.keys(obj).filter((k) => !CONDITIONS.includes(k)),
    ];
    return ordered.flatMap((k) => flatten(obj[k]));
  }
  return [];
}
