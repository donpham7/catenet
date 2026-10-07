// Python module resolution (ADR-0013 / ARCHITECTURE 2.1).
import { posix } from "node:path";
import { isWithin, normalizePyName } from "../discover/packages.js";
import type { PackageInfo } from "../model.js";
import { PYTHON_STDLIB } from "./python-stdlib.js";
import type { Resolution } from "./typescript.js";

export class PyResolver {
  private readonly projects: PackageInfo[];
  /** Top-level module names that exist locally under some source root (local wins over third-party). */
  private readonly localTopLevel = new Set<string>();
  /** `<project>/src` directories that contain Python files (src layout). */
  private readonly srcRoots = new Set<string>();

  constructor(
    private readonly files: Set<string>,
    packages: PackageInfo[],
  ) {
    this.projects = packages.filter((p) => p.manifest !== "package.json");
    for (const p of this.projects) {
      const src = p.path === "." ? "src" : `${p.path}/src`;
      if ([...files].some((f) => f.startsWith(`${src}/`) && f.endsWith(".py"))) this.srcRoots.add(src);
    }
    for (const root of this.allRoots()) {
      for (const f of files) {
        if (!f.endsWith(".py") || !isWithin(f, root)) continue;
        const rel = root === "." ? f : f.slice(root.length + 1);
        const top = rel.split("/")[0]?.replace(/\.py$/, "");
        if (top) this.localTopLevel.add(top);
      }
    }
  }

  private allRoots(): string[] {
    const roots: string[] = [];
    for (const p of this.projects) {
      roots.push(p.path);
      const src = p.path === "." ? "src" : `${p.path}/src`;
      if (this.srcRoots.has(src)) roots.push(src);
    }
    if (!roots.includes(".")) roots.push(".");
    return roots;
  }

  /** Source roots for a file: its own project(s) nearest first, then every other root, then the repo root. */
  private rootsFor(from: string): string[] {
    const expand = (p: string) => {
      const src = p === "." ? "src" : `${p}/src`;
      return this.srcRoots.has(src) ? [p, src] : [p];
    };
    const own = this.projects
      .filter((p) => isWithin(from, p.path))
      .sort((a, b) => b.path.length - a.path.length)
      .flatMap((p) => expand(p.path));
    return [...new Set([...own, ...this.allRoots()])];
  }

  /** `a.b.c` under a root -> `a/b/c.py` or `a/b/c/__init__.py`. */
  moduleFile(root: string, dotted: string): string | null {
    const rel = dotted.split(".").join("/");
    const base = root === "." ? rel : rel === "" ? root : `${root}/${rel}`;
    if (rel !== "" && this.files.has(`${base}.py`)) return `${base}.py`;
    const init = base === "" ? "__init__.py" : `${base}/__init__.py`;
    if (this.files.has(init)) return init;
    return null;
  }

  /** Submodule `name` of the package whose `__init__.py` is `initFile`. */
  submodule(initFile: string, name: string): string | null {
    if (!initFile.endsWith("__init__.py")) return null;
    return this.moduleFile(posix.dirname(initFile), name);
  }

  resolve(from: string, level: number, module: string, literal: boolean, specifier: string): Resolution {
    if (!literal) return { kind: "external", subkind: "unresolved", name: specifier };
    if (level > 0) {
      let dir = posix.dirname(from);
      for (let i = 1; i < level; i++) dir = posix.dirname(dir);
      const hit = this.moduleFile(dir, module);
      return hit
        ? { kind: "file", path: hit, confidence: "exact" }
        : { kind: "external", subkind: "unresolved", name: specifier };
    }
    for (const root of this.rootsFor(from)) {
      const hit = this.moduleFile(root, module);
      if (hit) return { kind: "file", path: hit, confidence: "exact" };
    }
    const top = module.split(".")[0] ?? module;
    if (this.localTopLevel.has(top)) return { kind: "external", subkind: "unresolved", name: specifier };
    if (PYTHON_STDLIB.has(top)) return { kind: "external", subkind: "builtin", name: top };
    return { kind: "external", subkind: "third_party", name: top };
  }

  isDeclared(from: string, name: string): boolean {
    return this.projects.some((p) => isWithin(from, p.path) && p.dependencies.has(normalizePyName(name)));
  }
}
