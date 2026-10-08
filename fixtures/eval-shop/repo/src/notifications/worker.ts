import { describeNotificationsHandler } from "./handler.ts";

export function describeNotificationsWorker(count: number): string {
  return `notifications:worker:${count}`;
}

export function summarizeNotificationsWorker(input: string[]): string {
  const base = describeNotificationsHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
