// Default export; uses formatDate only (not formatCurrency).
import { formatDate } from "@/lib/format";

export default function formatReceipt(lines: string[], when: Date): string {
  return [formatDate(when), ...lines].join("\n");
}
