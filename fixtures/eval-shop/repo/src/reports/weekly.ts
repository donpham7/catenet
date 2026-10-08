import { addDays, formatDate } from "../utils/date.ts";

export function weekRange(start: Date): string {
  return `${formatDate(start)}..${formatDate(addDays(start, 6))}`;
}
