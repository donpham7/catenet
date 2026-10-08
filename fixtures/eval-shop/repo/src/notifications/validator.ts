import { describeNotificationsMapper } from "./mapper.ts";

export function describeNotificationsValidator(count: number): string {
  return `notifications:validator:${count}`;
}

export function summarizeNotificationsValidator(input: string[]): string {
  const base = describeNotificationsMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
