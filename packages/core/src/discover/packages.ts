// Package discovery (ADR-0008): a package is a build unit, i.e. a directory with package.json, pyproject.toml or setup.py.
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { Lang } from "@catenet/parsers";
import { parse as parseToml } from "smol-toml";
import type { PackageInfo } from "../model.js";

const MANIFESTS = ["package.json", "pyproject.toml", "setup.py"] as const;
type Manifest = (typeof MANIFESTS)[number];

/** PEP 503 normalisation, used to compare Python distribution names. */
export const normalizePyName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

const pep508Name = (spec: string) => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1];

function readPackageJson(abs: string, dir: string): PackageInfo {
  const json = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
  const deps = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const value = json[field];
    if (value && typeof value === "object") for (const k of Object.keys(value)) deps.add(k);
  }
  return {
    path: dir,
    name: typeof json.name === "string" ? json.name : posix.basename(dir === "." ? "root" : dir),
    published: json.private !== true,
    manifest: "package.json",
    packageJson: json,
    dependencies: deps,
  };
}

function readPyproject(abs: string, dir: string): PackageInfo {
  const toml = parseToml(readFileSync(abs, "utf8")) as Record<string, Record<string, unknown> | undefined>;
  const project = toml.project ?? {};
  const deps = new Set<string>();
  const add = (spec: unknown) => {
    const n = typeof spec === "string" ? pep508Name(spec) : undefined;
    if (n) deps.add(normalizePyName(n));
  };
  for (const spec of (project.dependencies as unknown[] | undefined) ?? []) add(spec);
  for (const group of Object.values(
    (project["optional-dependencies"] as Record<string, unknown[]> | undefined) ?? {},
  )) {
    for (const spec of group) add(spec);
  }
  const poetry = (toml.tool as Record<string, Record<string, unknown>> | undefined)?.poetry;
  for (const name of Object.keys((poetry?.dependencies as Record<string, unknown> | undefined) ?? {})) {
    if (name !== "python") deps.add(normalizePyName(name));
  }
  const name =
    typeof project.name === "string"
      ? project.name
      : typeof poetry?.name === "string"
        ? poetry.name
        : undefined;
  return {
    path: dir,
    name: name ?? posix.basename(dir === "." ? "root" : dir),
    published: name !== undefined,
    manifest: "pyproject.toml",
    dependencies: deps,
  };
}

function readSetupPy(abs: string, dir: string): PackageInfo {
  const src = readFileSync(abs, "utf8");
  const name = /\bname\s*=\s*["']([^"']+)["']/.exec(src)?.[1];
  const deps = new Set<string>();
  const requires = /install_requires\s*=\s*\[([^\]]*)\]/s.exec(src)?.[1] ?? "";
  for (const m of requires.matchAll(/["']([^"']+)["']/g)) {
    const n = m[1] ? pep508Name(m[1]) : undefined;
    if (n) deps.add(normalizePyName(n));
  }
  return {
    path: dir,
    name: name ?? posix.basename(dir === "." ? "root" : dir),
    published: name !== undefined,
    manifest: "setup.py",
    dependencies: deps,
  };
}

export function discoverPackages(root: string, files: string[]): PackageInfo[] {
  const out: PackageInfo[] = [];
  for (const rel of files) {
    const base = posix.basename(rel) as Manifest;
    if (!MANIFESTS.includes(base)) continue;
    const dir = posix.dirname(rel);
    const abs = join(root, rel);
    try {
      if (base === "package.json") out.push(readPackageJson(abs, dir));
      else if (base === "pyproject.toml") out.push(readPyproject(abs, dir));
      // setup.py only counts when no pyproject.toml describes the same directory.
      else if (!files.includes(posix.join(dir === "." ? "" : dir, "pyproject.toml")))
        out.push(readSetupPy(abs, dir));
    } catch {
      // A malformed manifest is not fatal: the directory just isn't a package.
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.manifest.localeCompare(b.manifest));
}

export const isWithin = (file: string, dir: string) => dir === "." || file.startsWith(`${dir}/`);

/** Nearest enclosing package; when one directory has both kinds, prefer the manifest that matches the language. */
export function packageForFile(packages: PackageInfo[], path: string, lang: Lang): PackageInfo | undefined {
  let best: PackageInfo | undefined;
  for (const p of packages) {
    if (!isWithin(path, p.path)) continue;
    const depth = (pp: PackageInfo) => (pp.path === "." ? 0 : pp.path.split("/").length);
    if (!best || depth(p) > depth(best)) {
      best = p;
      continue;
    }
    if (depth(p) === depth(best)) {
      const wantsPy = lang === "python";
      const fits = (pp: PackageInfo) => (pp.manifest === "package.json") !== wantsPy;
      if (fits(p) && !fits(best)) best = p;
    }
  }
  return best;
}
