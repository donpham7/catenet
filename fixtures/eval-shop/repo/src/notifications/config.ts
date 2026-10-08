export function describeNotificationsConfig(count: number): string {
  return `notifications:config:${count}`;
}

export function summarizeNotificationsConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
