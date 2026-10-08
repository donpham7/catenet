import { formatDate } from "../utils/date.ts";

export interface Order {
  id: string;
  placedAt: Date;
  total: number;
}

export function historyLines(orders: Order[]): string[] {
  return orders.map((order) => `${formatDate(order.placedAt)} ${order.id}`);
}
