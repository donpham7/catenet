// File discovery. Inside a git work tree, git decides (honours .gitignore exactly); otherwise a walker with built-in
// ignores. Paths are repo-relative and POSIX-style.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".catenet",
  ".next",
  ".turbo",
  ".mypy_cache",
  ".pytest_cache",
]);

const toPosix = (p: string) => p.split(sep).join(posix.sep);
const inIgnoredDir = (rel: string) =>
  rel.split("/").some((seg, i, all) => i < all.length - 1 && IGNORED_DIRS.has(seg));

function gitFiles(root: string): string[] | null {
  try {
    const inside = execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (inside !== "true") return null;
    const out = execFileSync(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const files = out.split("\0").filter(Boolean);
    // A directory ignored by an enclosing repo lists nothing; fall back to walking it.
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
      } else if (entry.isFile()) out.push(toPosix(relative(root, join(dir, entry.name))));
    }
  }
  return out;
}

/** All candidate files under `root`, sorted. Files listed by git but deleted from the work tree are dropped. */
export function listRepoFiles(root: string): string[] {
  const listed = gitFiles(root) ?? walkFiles(root);
  return listed
    .filter((rel) => !inIgnoredDir(rel))
    .filter((rel) => {
      const abs = join(root, rel);
      return existsSync(abs) && statSync(abs).isFile();
    })
    .sort();
}

const TEST_SEGMENTS = new Set(["test", "tests", "__tests__"]);

/** Test-file convention (ADR-0002). Config-based detection is a later addition. */
export function isTestFile(path: string): boolean {
  const segments = path.split("/");
  const base = segments[segments.length - 1] ?? "";
  if (segments.slice(0, -1).some((s) => TEST_SEGMENTS.has(s))) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  return /^test_.+\.py$/.test(base) || /_test\.py$/.test(base);
}
