import { describeRatesService } from "./service.ts";

export function describeRatesStore(count: number): string {
  return `rates:store:${count}`;
}

export function summarizeRatesStore(input: string[]): string {
  const base = describeRatesService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
