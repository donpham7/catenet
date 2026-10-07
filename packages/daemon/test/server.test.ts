// In-process daemon behaviour: indexing, watching, batching, error reporting, idle exit, single instance.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openGraph } from "@catenet/core";
import { afterEach, describe, expect, it } from "vitest";
import { AlreadyRunningError, createDaemon, type Daemon, health } from "../src/index.js";
import { fixtureCopy, until } from "./helpers.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function start(opts: { idleMs?: number; dbPath?: string; onStop?: () => void } = {}): {
  daemon: Daemon;
  root: string;
} {
  const repo = fixtureCopy("ts-basic");
  mkdirSync(repo.runtime, { recursive: true });
  const daemon = createDaemon({
    root: repo.root,
    socket: join(repo.runtime, "d.sock"),
    log: () => {},
    ...opts,
  });
  cleanups.push(repo.cleanup, () => daemon.stop());
  return { daemon, root: repo.root };
}

describe("daemon", () => {
  it("indexes on start and answers health", async () => {
    const { daemon, root } = start();
    await daemon.start();
    const h = await until(() => daemon.snapshot().lastIndex);
    expect(h.mode).toBe("rebuild");
    expect(h.files).toBe(23);
    const remote = await health(daemon.socket);
    expect(remote).toMatchObject({ ok: true, root, pid: process.pid });
    await until(() => daemon.snapshot().watching);
  });

  it("picks up file changes through the watcher", async () => {
    const { daemon, root } = start();
    await daemon.start();
    await until(() => daemon.snapshot().watching && daemon.snapshot().lastIndex);
    writeFileSync(
      join(root, "src/new.ts"),
      'import { formatCurrency } from "./lib/format";\nexport const x = formatCurrency(1);\n',
    );
    await until(() => {
      const g = openGraph(join(root, ".catenet/graph.db"));
      try {
        return g.dependents("src/lib/format.ts").direct.some((d) => d.file === "src/new.ts");
      } finally {
        g.close();
      }
    }, 5000);
  });

  it("batches concurrent index requests and resolves them all", async () => {
    const { daemon } = start();
    await daemon.start();
    await until(() => daemon.snapshot().lastIndex);
    const results = await Promise.all([daemon.index(), daemon.index(), daemon.index(true)]);
    expect(results.map((r) => r.files)).toEqual([23, 23, 23]);
    expect(results.some((r) => r.mode === "rebuild")).toBe(true);
    expect(daemon.snapshot().indexing).toBe(false);
  });

  it("reports an index failure in health and keeps serving", async () => {
    const repo = fixtureCopy("ts-basic");
    cleanups.push(repo.cleanup);
    mkdirSync(repo.runtime, { recursive: true });
    const badDb = join(repo.root, "not-a-db");
    mkdirSync(badDb); // a directory where the database file should be
    const daemon = createDaemon({
      root: repo.root,
      dbPath: badDb,
      socket: join(repo.runtime, "d.sock"),
      log: () => {},
    });
    cleanups.push(() => daemon.stop());
    await daemon.start();
    const last = await until(() => daemon.snapshot().lastIndex);
    expect(last.error).toBeTruthy();
    expect((await health(daemon.socket)).ok).toBe(true);
  });

  it("exits when idle", async () => {
    let stopped = false;
    const { daemon } = start({ idleMs: 300, onStop: () => (stopped = true) });
    await daemon.start();
    await until(() => stopped, 5000);
    expect(existsSync(daemon.socket)).toBe(false);
  });

  it("refuses to start a second daemon on the same socket", async () => {
    const { daemon, root } = start();
    await daemon.start();
    const second = createDaemon({ root, socket: daemon.socket, log: () => {} });
    await expect(second.start()).rejects.toBeInstanceOf(AlreadyRunningError);
  });
});
