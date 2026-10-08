export function getCartSnapshot(id: string): { id: string; takenAt: number } {
  return { id, takenAt: 0 };
}
