export function describeUsersConfig(count: number): string {
  return `users:config:${count}`;
}

export function summarizeUsersConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
