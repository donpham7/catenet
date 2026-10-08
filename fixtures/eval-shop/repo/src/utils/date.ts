export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDate(text: string): Date {
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${text}`);
  return date;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
