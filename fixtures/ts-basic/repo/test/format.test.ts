import { describe, expect, it } from "vitest";
import { formatCurrency } from "../src/lib";

describe("formatCurrency", () => {
  it("formats dollars", () => {
    expect(formatCurrency(1.005)).toBe("$1.01");
  });
});
