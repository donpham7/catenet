export function formatPrice(amount: number): string {
  return `$${roundCents(amount).toFixed(2)}`;
}

export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
