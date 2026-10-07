// Indexer: discover -> extract (changed files only) -> resolve -> write (ADR-0013).
//
// Two modes, both producing exactly what a full rebuild would (verified by the incremental-vs-full test):
// - rebuild: clear the derived graph and write every file from facts (re-extracting only changed files). Used for
//   --full, the first run, and any manifest/tsconfig change.
// - update: files changed, added or deleted. Re-resolve changed and added files, every file whose import resolution
//   differs between the old and new file sets, and the importers of any file whose export surface changed
//   (following files that re-expose those names).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { EXTRACTOR_VERSION, type FileFacts, langForPath, loadExtractor } from "@catenet/parsers";
import { isTestFile, listRepoFiles } from "../discover/files.js";
import { discoverPackages, packageForFile } from "../discover/packages.js";
import type { FileRecord, NodeKey, PackageInfo } from "../model.js";
import { RepoModel } from "../resolve/model.js";
import { tsconfigChainFiles } from "../resolve/typescript.js";
import { SqliteGraphStore } from "../store/sqlite-store.js";

export interface IndexOptions {
  root: string;
  /** Defaults to `<root>/.catenet/graph.db`. */
  dbPath?: string;
  full?: boolean;
}

export interface IndexStats {
  mode: "rebuild" | "update" | "noop";
  files: number;
  extracted: number;
  resolved: number;
  added: number;
  deleted: number;
  changed: number;
  parseErrorFiles: string[];
  ms: number;
}

const CONFIG_FILES = new Set(["package.json", "pyproject.toml", "setup.py", "tsconfig.json"]);
const isConfig = (path: string) =>
  CONFIG_FILES.has(posix.basename(path)) || /(^|\/)tsconfig\.[^/]*\.json$/.test(path);
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex").slice(0, 20);

export const defaultDbPath = (root: string) => join(root, ".catenet", "graph.db");

export async function indexRepo(opts: IndexOptions): Promise<IndexStats> {
  const started = performance.now();
  const root = opts.root;
  const store = new SqliteGraphStore(opts.dbPath ?? defaultDbPath(root));
  try {
    const allPaths = listRepoFiles(root);
    const codePaths = allPaths.filter((p) => langForPath(p) !== null);
    const configFiles = [
      ...new Set([...allPaths.filter(isConfig), ...tsconfigChainFiles(root, allPaths)]),
    ].sort();
    const configHash = sha(
      configFiles.map((p) => `${p}\0${readFileSync(join(root, p), "utf8")}`).join("\0\0"),
    );

    const prior = store.loadFacts();
    // Stored facts are a cache: never trusted by --full or across extractor versions.
    const reuseFacts = opts.full !== true && store.getMeta("extractor_version") === String(EXTRACTOR_VERSION);
    const configChanged = store.getMeta("config_hash") !== configHash;

    // Read and hash everything first; stored facts are only parsed for files that are actually needed.
    const sources = new Map<string, { source: string; hash: string }>();
    for (const path of codePaths) {
      const source = readFileSync(join(root, path), "utf8");
      sources.set(path, { source, hash: sha(source) });
    }
    const unchangedRepo =
      reuseFacts &&
      !configChanged &&
      prior.size === codePaths.length &&
      codePaths.every((p) => prior.get(p)?.hash === sources.get(p)?.hash);
    if (unchangedRepo) {
      return {
        mode: "noop",
        files: codePaths.length,
        extracted: 0,
        resolved: 0,
        added: 0,
        deleted: 0,
        changed: 0,
        parseErrorFiles: store.filesWithParseErrors(),
        ms: performance.now() - started,
      };
    }

    const extractor = await loadExtractor();
    const files = new Map<string, FileRecord>();
    const oldSurface = new Map<string, string>();
    const changed: string[] = [];
    let extracted = 0;
    for (const path of codePaths) {
      const lang = langForPath(path);
      const read = sources.get(path);
      if (!lang || !read) continue;
      const { source, hash } = read;
      const cached = prior.get(path);
      let facts: FileFacts;
      if (reuseFacts && cached && cached.hash === hash) facts = JSON.parse(cached.factsJson) as FileFacts;
      else {
        facts = extractor.extract(source, lang);
        extracted++;
        if (cached && cached.hash !== hash) {
          changed.push(path);
          // Old facts are only analysed when they are trusted; otherwise this run rebuilds anyway.
          if (reuseFacts)
            oldSurface.set(path, RepoModel.exportSurface(JSON.parse(cached.factsJson) as FileFacts));
        }
      }
      files.set(path, { path, lang, hash, isTest: isTestFile(path), facts });
    }
    const added = codePaths.filter((p) => !prior.has(p));
    const deleted = [...prior.keys()].filter((p) => !files.has(p));
    const packages = discoverPackages(root, allPaths);
    const model = new RepoModel(files, packages, new Set(allPaths), root);

    const rebuild = opts.full === true || prior.size === 0 || configChanged || !reuseFacts;
    const touched = changed.length + added.length + deleted.length > 0;
    let resolvedCount = 0;

    if (rebuild) {
      store.transaction(() => {
        store.clear();
        writeStructure(store, root, packages);
        for (const rec of files.values()) writeFile(store, rec, packages);
        for (const rec of files.values()) writeEdges(store, model, rec.path);
        for (const rec of files.values()) store.recomputeFileDeps(rec.path);
        writePublished(store, model);
        store.deleteOrphanExternals();
        store.setMeta("config_hash", configHash);
        store.setMeta("extractor_version", String(EXTRACTOR_VERSION));
      });
      resolvedCount = files.size;
    } else if (touched) {
      // Everything below reads the graph as it was, before any writes.
      const reresolve = new Set<string>([...changed, ...added]);
      const propagateFrom = changed.filter((p) => {
        const rec = files.get(p);
        return rec !== undefined && RepoModel.exportSurface(rec.facts) !== oldSurface.get(p);
      });
      if (added.length > 0 || deleted.length > 0) {
        // Import resolution depends on which files exist: re-resolve every file whose imports now resolve differently.
        const oldFiles = new Map<string, FileRecord>();
        const changedSet = new Set(changed);
        for (const [path, cached] of prior) {
          const unchanged = files.get(path);
          if (unchanged && !changedSet.has(path)) {
            oldFiles.set(path, unchanged); // same content, already parsed
            continue;
          }
          const lang = langForPath(path);
          if (lang) {
            const facts = JSON.parse(cached.factsJson) as FileFacts;
            oldFiles.set(path, { path, lang, hash: cached.hash, isTest: isTestFile(path), facts });
          }
        }
        const addedSet = new Set(added);
        const oldModel = new RepoModel(
          oldFiles,
          packages,
          new Set([...allPaths.filter((p) => !addedSet.has(p)), ...deleted]),
          root,
        );
        for (const path of files.keys()) {
          if (!oldFiles.has(path)) continue;
          const before = JSON.stringify(oldModel.imports(path).map((i) => i.resolution));
          const after = JSON.stringify(model.imports(path).map((i) => i.resolution));
          if (before !== after) {
            reresolve.add(path);
            propagateFrom.push(path);
          }
        }
        // Files with edges into a deleted file, and Python packages whose set of submodules changed.
        propagateFrom.push(...deleted);
        for (const path of [...added, ...deleted]) {
          if (!path.endsWith(".py")) continue;
          const pkgDir = path.endsWith("/__init__.py")
            ? posix.dirname(posix.dirname(path))
            : posix.dirname(path);
          const init = pkgDir === "." ? "__init__.py" : `${pkgDir}/__init__.py`;
          if (files.has(init) || oldFiles.has(init)) propagateFrom.push(init);
        }
      }
      const seen = new Set(propagateFrom);
      const queue = [...propagateFrom];
      while (queue.length > 0) {
        const target = queue.shift() as string;
        for (const importer of store.importersOf(target)) {
          reresolve.add(importer);
          if (!seen.has(importer) && model.reexposes(importer, target)) {
            seen.add(importer);
            queue.push(importer);
          }
        }
      }
      store.transaction(() => {
        for (const path of deleted) store.deleteFile(path);
        for (const path of [...changed, ...added]) {
          const rec = files.get(path);
          if (rec) writeFile(store, rec, packages);
        }
        const live = [...reresolve].filter((p) => files.has(p));
        for (const path of live) writeEdges(store, model, path);
        for (const path of live) store.recomputeFileDeps(path);
        writePublished(store, model);
        store.deleteOrphanExternals();
      });
      resolvedCount = [...reresolve].filter((p) => files.has(p)).length;
    }

    return {
      mode: rebuild ? "rebuild" : touched ? "update" : "noop",
      files: files.size,
      extracted,
      resolved: resolvedCount,
      added: rebuild && prior.size === 0 ? 0 : added.length,
      deleted: deleted.length,
      changed: changed.length,
      parseErrorFiles: [...files.values()].filter((f) => f.facts.parseErrors > 0).map((f) => f.path),
      ms: performance.now() - started,
    };
  } finally {
    store.close();
  }
}

function writeStructure(store: SqliteGraphStore, root: string, packages: PackageInfo[]): void {
  const repoId = store.upsertNode({
    kind: "repo",
    name: posix.basename(root.split("\\").join("/")) || "repo",
    path: ".",
  });
  for (const p of packages) {
    const id = store.upsertNode({
      kind: "package",
      name: p.name,
      path: p.path,
      subkind: p.manifest,
      attrs: { published: p.published, manifest: p.manifest },
    });
    store.setContains(repoId, id);
  }
}

function writeFile(store: SqliteGraphStore, rec: FileRecord, packages: PackageInfo[]): void {
  const fileId = store.upsertNode({
    kind: "file",
    subkind: rec.isTest ? "test" : "source",
    name: posix.basename(rec.path),
    path: rec.path,
    lang: rec.lang,
    hash: rec.hash,
    attrs: { parseErrors: rec.facts.parseErrors },
  });
  store.syncSymbols(
    fileId,
    rec.path,
    rec.facts.symbols.map((s) => ({
      name: s.qualifiedName,
      subkind: s.subkind,
      startLine: s.startLine,
      endLine: s.endLine,
      attrs: { exportNames: s.exportNames },
    })),
  );
  store.putFacts(fileId, rec.hash, JSON.stringify(rec.facts));
  const pkg = packageForFile(packages, rec.path, rec.lang);
  if (pkg) {
    const pkgId = store.upsertNode({
      kind: "package",
      name: pkg.name,
      path: pkg.path,
      subkind: pkg.manifest,
      attrs: { published: pkg.published, manifest: pkg.manifest },
    });
    store.setContains(pkgId, fileId);
  }
}

function writeEdges(store: SqliteGraphStore, model: RepoModel, path: string): void {
  store.replaceOutgoing(path, model.edgesFor(path), (key: NodeKey) => {
    if (key.kind !== "external") throw new Error("only externals are created on demand");
    return store.upsertNode({ kind: "external", subkind: key.subkind, name: key.name });
  });
}

function writePublished(store: SqliteGraphStore, model: RepoModel): void {
  const { symbols, files } = model.publishedApi();
  const ids = new Set<number>();
  for (const key of symbols) {
    const id = store.nodeId(key);
    if (id !== undefined) ids.add(id);
  }
  for (const path of files) {
    const id = store.nodeId({ kind: "file", path });
    if (id !== undefined) ids.add(id);
  }
  store.setPublished(ids);
}
