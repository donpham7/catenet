// File watching (ADR-0014). chokidar can skip ignored directories entirely (no inotify watches on node_modules). The
// watcher only signals "something changed"; the indexer's hash comparison decides what.
import { relative, sep } from "node:path";
import { affectsGraph, IGNORED_DIRS } from "@catenet/core";
import { watch } from "chokidar";

export interface RepoWatcher {
  ready: Promise<void>;
  close(): Promise<void>;
}

export function watchRepo(root: string, onChange: () => void, debounceMs = 200): RepoWatcher {
  // Segments are taken relative to the root, so a parent directory named e.g. "build" doesn't hide the whole repo.
  const ignored = (path: string) => {
    const rel = relative(root, path);
    return rel !== "" && rel.split(sep).some((seg) => IGNORED_DIRS.has(seg));
  };
  const watcher = watch(root, { ignored, ignoreInitial: true, persistent: true });
  let timer: NodeJS.Timeout | undefined;
  watcher.on("all", (event, path) => {
    // Logs, caches and build output can't change the graph; don't rescan for them (M2 review #5). A removed directory
    // still counts (it can hold code); a new directory is empty until its files arrive with their own events.
    if (event === "addDir") return;
    if (event !== "unlinkDir" && !affectsGraph(relative(root, path).split(sep).join("/"))) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  const ready = new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  return {
    ready,
    async close() {
      clearTimeout(timer);
      await watcher.close();
    },
  };
}
