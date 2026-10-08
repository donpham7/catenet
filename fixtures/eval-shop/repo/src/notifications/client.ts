import { describeNotificationsParser } from "./parser.ts";

export function describeNotificationsClient(count: number): string {
  return `notifications:client:${count}`;
}

export function summarizeNotificationsClient(input: string[]): string {
  const base = describeNotificationsParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
