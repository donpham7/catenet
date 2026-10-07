// Diff stats without storing content: lines added/removed as a multiset difference (order-insensitive, cheap, and
// exact for the counts that matter in a report).

const lines = (text: string | null): string[] => {
  if (text === null || text === "") return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
};

export function lineDiff(before: string | null, after: string | null): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const l of lines(before)) counts.set(l, (counts.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of lines(after)) {
    const n = counts.get(l) ?? 0;
    if (n > 0) counts.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return { added, removed };
}
