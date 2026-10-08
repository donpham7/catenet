import { describeNotificationsRules } from "./rules.ts";

export function describeNotificationsEvents(count: number): string {
  return `notifications:events:${count}`;
}

export function summarizeNotificationsEvents(input: string[]): string {
  const base = describeNotificationsRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
