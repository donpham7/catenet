// Opt-in lookup (ADR-0015): only `catenet init` (which writes .catenet/config.json) opts a repository in, and a
// .catenet in the home directory or the filesystem root never captures the projects below it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOptedInRoot } from "@catenet/core";
import { afterAll, describe, expect, it } from "vitest";
import { findRepoRoot } from "../src/index.js";

const home = mkdtempSync(join(tmpdir(), "cnr-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const optIn = (dir: string) => {
  mkdirSync(join(dir, ".catenet"), { recursive: true });
  writeFileSync(join(dir, ".catenet/config.json"), "{}");
};

describe.each([
  ["hook client", findRepoRoot],
  ["core", findOptedInRoot],
])("%s repository lookup", (_name, find) => {
  it("finds the opted-in repository from a subdirectory", () => {
    const repo = join(home, "a/repo");
    mkdirSync(join(repo, "src/lib"), { recursive: true });
    optIn(repo);
    expect(find(join(repo, "src/lib"), home)).toBe(repo);
  });

  it("ignores a .catenet folder without config.json", () => {
    const repo = join(home, "b/repo");
    mkdirSync(join(repo, ".catenet"), { recursive: true });
    expect(find(repo, home)).toBeNull();
  });

  it("never accepts the home directory, so a stray .catenet there captures nothing", () => {
    optIn(home);
    const other = join(home, "c/project");
    mkdirSync(other, { recursive: true });
    expect(find(other, home)).toBeNull();
    expect(find(home, home)).toBeNull();
  });
});
