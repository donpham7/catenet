import { describeSupportFactory } from "./factory.ts";

export function describeSupportHelpers(count: number): string {
  return `support:helpers:${count}`;
}

export function summarizeSupportHelpers(input: string[]): string {
  const base = describeSupportFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
