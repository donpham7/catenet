// tsconfig path alias + cross-file inheritance.
import { formatCurrency } from "@/lib/format";
import { BaseWidget } from "./base";

export class Widget extends BaseWidget {
  amount = 0;

  override render(): string {
    return formatCurrency(this.amount);
  }
}
