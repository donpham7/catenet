import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Graph, indexRepo, openGraph } from "../src/index.js";

export interface TempRepo {
  root: string;
  dbPath: string;
  graph(): Graph;
  index(full?: boolean): ReturnType<typeof indexRepo>;
  write(rel: string, content: string): void;
  cleanup(): void;
}

/** A throwaway repo (not a git repo, so discovery uses the walker) built from a path -> content map. */
export function makeRepo(files: Record<string, string>): TempRepo {
  const tmp = mkdtempSync(join(tmpdir(), "catenet-test-"));
  const root = join(tmp, "repo");
  const dbPath = join(tmp, "graph.db");
  const write = (rel: string, content: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  return {
    root,
    dbPath,
    graph: () => openGraph(dbPath),
    index: (full = false) => indexRepo({ root, dbPath, full }),
    write,
    cleanup: () => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}
