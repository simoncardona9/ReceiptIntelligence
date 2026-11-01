import { describe, expect, it } from "vitest";
import { parsePesos, pesosDisplay, pesosInput } from "./money";

describe("peso UI conversion", () => {
  it("converts decimal pesos exactly to integer centésimos", () => {
    expect(parsePesos("122,00")).toBe(12200);
    expect(parsePesos("1.234,56")).toBe(123456);
    expect(parsePesos("1234.56")).toBe(123456);
    expect(parsePesos("0,01")).toBe(1);
    expect(parsePesos("1,2")).toBe(120);
    expect(parsePesos("1.234")).toBe(123400);
  });

  it("rejects fractions smaller than a centésimo and unsafe amounts", () => {
    for (const value of [
      "",
      "1,234",
      "-1,00",
      "1,2,3",
      "abc",
      "90071992547409,92",
    ])
      expect(parsePesos(value)).toBeNull();
  });

  it("formats API values as pesos with two decimals", () => {
    expect(pesosInput(123456)).toBe("1234,56");
    expect(pesosDisplay(123456)).toBe("1.234,56");
    expect(pesosDisplay(1)).toBe("0,01");
  });
});
