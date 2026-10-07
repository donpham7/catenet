// Literal dynamic import resolves (exact). Template dynamic import cannot be resolved (unresolved external).
export async function loadBuiltin(): Promise<(rows: number[]) => string> {
  const csv = await import("./csv");
  return csv.toCsv;
}

export async function loadPlugin(name: string): Promise<unknown> {
  return import(`./${name}`);
}
