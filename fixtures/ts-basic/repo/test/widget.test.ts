import { expect, it } from "vitest";
import { Widget } from "../src/ui/widget";

it("renders the amount", () => {
  const w = new Widget();
  w.amount = 2;
  expect(w.render()).toBe("$2.00");
});
