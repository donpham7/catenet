import { describeUsersMetrics } from "./metrics.ts";

export function describeUsersHandler(count: number): string {
  return `users:handler:${count}`;
}

export function summarizeUsersHandler(input: string[]): string {
  const base = describeUsersMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
