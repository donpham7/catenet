import { describeNotificationsFormatter } from "./formatter.ts";

export function describeNotificationsParser(count: number): string {
  return `notifications:parser:${count}`;
}

export function summarizeNotificationsParser(input: string[]): string {
  const base = describeNotificationsFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
