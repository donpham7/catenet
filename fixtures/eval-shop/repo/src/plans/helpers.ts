import { describePlansFactory } from "./factory.ts";

export function describePlansHelpers(count: number): string {
  return `plans:helpers:${count}`;
}

export function summarizePlansHelpers(input: string[]): string {
  const base = describePlansFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
