import { describeNotificationsWorker } from "./worker.ts";

export function describeNotificationsRegistry(count: number): string {
  return `notifications:registry:${count}`;
}

export function summarizeNotificationsRegistry(input: string[]): string {
  const base = describeNotificationsWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
