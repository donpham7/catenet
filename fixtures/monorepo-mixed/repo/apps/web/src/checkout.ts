import { PriceTag } from "@acme/ui";
import { slugify } from "@acme/utils";

export function checkout(title: string, amount: number): string {
  return `<h1 id="${slugify(title)}">${title}</h1>${PriceTag(amount)}`;
}
