import { expect, it } from "vitest";
import { checkout } from "../src/checkout";

it("renders a price tag", () => {
  expect(checkout("My Cart", 1)).toContain("$1.00");
});
