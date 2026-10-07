import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Io, main, sanitize } from "../src/index.js";

const FIXTURE = join(import.meta.dirname, "../../../fixtures/ts-basic/repo");
const tmp = mkdtempSync(join(tmpdir(), "catenet-cli-"));
const repo = join(tmp, "repo");

function run(...argv: string[]): { code: Promise<number>; out: string[]; err: string[] } {
  return runIn(tmp, ...argv);
}

function runIn(cwd: string, ...argv: string[]): { code: Promise<number>; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), cwd };
  return { code: main([...argv, "--repo", repo], io), out, err };
}

beforeAll(() => {
  // Skip any local index someone created by running the CLI on the fixture.
  cpSync(FIXTURE, repo, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes(".catenet") });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("catenet CLI", () => {
  it("asks for an index before queries", async () => {
    const r = run("impact", "src/lib/format.ts");
    expect(await r.code).toBe(1);
    expect(r.err.join("\n")).toContain("catenet index");
  });

  it("index builds the graph", async () => {
    const r = run("index");
    expect(await r.code).toBe(0);
    expect(r.out[0]).toMatch(/^indexed 23 files in \d+ ms \(rebuild; parsed 23, resolved 23\)$/);
  });

  it("dependents prints direct and indirect files", async () => {
    const r = run("dependents", "src/lib/format.ts");
    expect(await r.code).toBe(0);
    expect(r.out[0]).toBe("dependents of src/lib/format.ts: 8 direct, 11 transitive (files)");
    expect(r.out).toContain("indirect:");
    expect(r.out).toContain("  src/plugins/loader.ts");
  });

  it("dependents --depth 1 stops at direct", async () => {
    const r = run("dependents", "src/lib/format.ts", "--depth", "1", "--json");
    expect(await r.code).toBe(0);
    const json = JSON.parse(r.out.join("\n")) as { direct: unknown[]; transitive: unknown[] };
    expect(json.transitive).toHaveLength(json.direct.length);
  });

  it("impact explains the blast radius with static coverage and unresolved imports", async () => {
    const r = run("impact", "src/lib/format.ts");
    expect(await r.code).toBe(0);
    const text = r.out.join("\n");
    expect(text).toContain("published API:         yes");
    expect(text).toContain("direct dependents:     8 files");
    expect(text).toContain("tests (static):        2 of 11 dependents reached by a test");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the unresolved specifier as written in the source file
    expect(text).toContain("src/plugins/loader.ts:8  ./${name}");
    expect(text).toContain("src/checkout/total.ts  calls formatCurrency @6");
  });

  it("impact --json returns the structured result", async () => {
    const r = run("impact", "src/lib/format.ts#formatCurrency", "--json");
    expect(await r.code).toBe(0);
    const json = JSON.parse(r.out.join("\n")) as {
      target: { id: string };
      direct: unknown[];
      tests: { kind: string };
    };
    expect(json.target.id).toBe("src/lib/format.ts#formatCurrency");
    expect(json.direct).toHaveLength(7);
    expect(json.tests.kind).toBe("static");
  });

  it("deps lists what a file depends on", async () => {
    const r = run("deps", "src/checkout/receipt.ts");
    expect(await r.code).toBe(0);
    expect(r.out).toContain("  src/checkout/receipt-format.ts");
    expect(r.out).toContain("  src/lib/format.ts");
  });

  it("bare symbol names resolve; unknown targets exit 2 with candidates", async () => {
    const ok = run("dependents", "BaseWidget");
    expect(await ok.code).toBe(0);
    expect(ok.out[0]).toContain("src/ui/base.ts#BaseWidget");
    const bad = run("impact", "src/lib/format.ts#nope");
    expect(await bad.code).toBe(2);
    expect(bad.err).toContain("candidates:");
  });

  it("resolves target paths relative to the current directory", async () => {
    const fromSubdir = runIn(join(repo, "src"), "dependents", "lib/format.ts");
    expect(await fromSubdir.code).toBe(0);
    expect(fromSubdir.out[0]).toContain("dependents of src/lib/format.ts:");
    const dotted = runIn(repo, "dependents", "./src/lib/format.ts");
    expect(await dotted.code).toBe(0);
    expect(dotted.out[0]).toContain("dependents of src/lib/format.ts:");
    const absolute = run("dependents", join(repo, "src/lib/format.ts"));
    expect(await absolute.code).toBe(0);
  });

  it("rejects unknown commands", async () => {
    expect(await run("frobnicate").code).toBe(1);
  });
});

describe("sanitize", () => {
  it("strips ANSI escapes and control characters from repo-derived text", () => {
    expect(sanitize("src/\x1b[31mevil\x1b[0m.ts\x07")).toBe("src/evil.ts");
  });

  it("strips newlines, C1 controls and bidi overrides so repo text cannot forge output lines", () => {
    expect(sanitize("a.ts\n  published API:         no")).toBe("a.ts  published API:         no");
    expect(sanitize("a\r\tb\u009b31mc\u0085d")).toBe("abcd");
    expect(sanitize("x\u202ey\u2066z")).toBe("xyz");
  });

  it("caps length", () => {
    const long = "a".repeat(1000);
    expect(sanitize(long).length).toBeLessThanOrEqual(300);
    expect(sanitize(long).endsWith("…")).toBe(true);
  });
});
