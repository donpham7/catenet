import { describePlansMapper } from "./mapper.ts";

export function describePlansValidator(count: number): string {
  return `plans:validator:${count}`;
}

export function summarizePlansValidator(input: string[]): string {
  const base = describePlansMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
