type Formatter = (value: number) => string;

/** A column of an export: the module and function that format its values. */
export const PRICE_COLUMN = { module: "money/format", fn: "formatPrice" } as const;

export async function exportColumn(module: string, fn: string, values: number[]): Promise<string[]> {
  const mod = (await import(`../${module}.ts`)) as Record<string, Formatter | undefined>;
  const format = mod[fn];
  if (!format) throw new Error(`unknown formatter ${module}.${fn}`);
  return values.map((value) => format(value));
}
