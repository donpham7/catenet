import { describeNotificationsValidator } from "./validator.ts";

export function describeNotificationsFormatter(count: number): string {
  return `notifications:formatter:${count}`;
}

export function summarizeNotificationsFormatter(input: string[]): string {
  const base = describeNotificationsValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
