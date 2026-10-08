import { describeUsersEvents } from "./events.ts";

export function describeUsersMetrics(count: number): string {
  return `users:metrics:${count}`;
}

export function summarizeUsersMetrics(input: string[]): string {
  const base = describeUsersEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
