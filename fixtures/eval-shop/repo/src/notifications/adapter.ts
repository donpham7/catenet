import { describeNotificationsRegistry } from "./registry.ts";

export function describeNotificationsAdapter(count: number): string {
  return `notifications:adapter:${count}`;
}

export function summarizeNotificationsAdapter(input: string[]): string {
  const base = describeNotificationsRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
