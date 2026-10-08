import { describeNotificationsAdapter } from "./adapter.ts";

export function describeNotificationsFactory(count: number): string {
  return `notifications:factory:${count}`;
}

export function summarizeNotificationsFactory(input: string[]): string {
  const base = describeNotificationsAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
