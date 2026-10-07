// Cross-package import by workspace package name.
import { formatCurrency } from "@acme/utils";
import { ICONS } from "./generated/icons";
import { theme } from "./internal/theme";

export function PriceTag(amount: number): string {
  return `${ICONS.tag} <span style="color:${theme.accent}">${formatCurrency(amount)}</span>`;
}
