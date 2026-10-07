export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// Exported from this file but NOT from the package entry point, and used nowhere.
export function internalPad(s: string, width: number): string {
  return s.padStart(width);
}
