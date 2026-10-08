import { describeNotificationsFactory } from "./factory.ts";

export function describeNotificationsHelpers(count: number): string {
  return `notifications:helpers:${count}`;
}

export function summarizeNotificationsHelpers(input: string[]): string {
  const base = describeNotificationsFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
