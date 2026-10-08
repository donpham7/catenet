import { describeNotificationsEvents } from "./events.ts";

export function describeNotificationsMetrics(count: number): string {
  return `notifications:metrics:${count}`;
}

export function summarizeNotificationsMetrics(input: string[]): string {
  const base = describeNotificationsEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
