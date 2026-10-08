import { describeNotificationsMetrics } from "./metrics.ts";

export function describeNotificationsHandler(count: number): string {
  return `notifications:handler:${count}`;
}

export function summarizeNotificationsHandler(input: string[]): string {
  const base = describeNotificationsMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
