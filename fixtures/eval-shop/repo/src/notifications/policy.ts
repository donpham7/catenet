import { describeNotificationsCache } from "./cache.ts";

export function describeNotificationsPolicy(count: number): string {
  return `notifications:policy:${count}`;
}

export function summarizeNotificationsPolicy(input: string[]): string {
  const base = describeNotificationsCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
