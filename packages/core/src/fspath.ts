// Comparing paths that may reach the same place through symlinks. Agents report the paths they see (on macOS the temp
// directory is /var -> /private/var), and a repository may itself be reached through a symlink, so containment checks
// compare resolved real paths (found by the M4 pilot: edit context never fired under /var/folders).
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

/** The real path of `p`, resolving symlinks in its existing ancestors when `p` itself doesn't exist yet. */
export function canonicalPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : resolve(canonicalPath(parent), basename(abs));
  }
}

/**
 * `path` relative to the repository `root` (forward slashes), or null when it lies outside. Symlinks are resolved in
 * the directories only, not in the file name: the indexer keys a symlinked file by its own path, so a symlinked file
 * inside the repository keeps that name (M4 review). Reading a file still checks its real path (ADR-0015).
 */
export function repoRelative(path: string, root: string, cwd = root): string | null {
  const abs = resolve(isAbsolute(path) ? path : resolve(cwd, path));
  const rel = relative(canonicalPath(root), resolve(canonicalPath(dirname(abs)), basename(abs)));
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split("\\").join("/") : null;
}
