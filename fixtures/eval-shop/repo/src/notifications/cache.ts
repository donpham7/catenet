import { describeNotificationsClient } from "./client.ts";

export function describeNotificationsCache(count: number): string {
  return `notifications:cache:${count}`;
}

export function summarizeNotificationsCache(input: string[]): string {
  const base = describeNotificationsClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
