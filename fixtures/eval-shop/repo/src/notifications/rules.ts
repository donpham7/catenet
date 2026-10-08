import { describeNotificationsPolicy } from "./policy.ts";

export function describeNotificationsRules(count: number): string {
  return `notifications:rules:${count}`;
}

export function summarizeNotificationsRules(input: string[]): string {
  const base = describeNotificationsPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
