export function formatPriceRange(min: number, max: number): string {
  return `${min.toFixed(2)}-${max.toFixed(2)}`;
}
