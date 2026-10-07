// Runs indexRepo off the daemon's main thread, so /health (and M3's hook endpoint) answer instantly while a long
// index is in progress (M2 review #1).
import { parentPort } from "node:worker_threads";
import { indexRepo } from "@catenet/core";

export interface IndexJob {
  id: number;
  root: string;
  dbPath?: string;
  full: boolean;
}

parentPort?.on("message", async (job: IndexJob) => {
  try {
    const stats = await indexRepo({ root: job.root, dbPath: job.dbPath, full: job.full });
    parentPort?.postMessage({ id: job.id, stats });
  } catch (err) {
    parentPort?.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
});
