import { describePlansModel } from "./model.ts";

export function describePlansMapper(count: number): string {
  return `plans:mapper:${count}`;
}

export function summarizePlansMapper(input: string[]): string {
  const base = describePlansModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
