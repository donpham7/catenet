import { describePlansService } from "./service.ts";

export function describePlansStore(count: number): string {
  return `plans:store:${count}`;
}

export function summarizePlansStore(input: string[]): string {
  const base = describePlansService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
