import { describe, expect, it } from "vitest";
import { rankProduct, type Product } from "./product-service";

const product: Product = {
  id: "synthetic",
  name: "Leche entera",
  nameKey: "leche entera",
  brand: "Marca A",
  brandKey: "marca a",
};
describe("product matching", () => {
  it("requires confirmation when the brand differs or is unknown", () => {
    expect(
      rankProduct("Leche entera", "Marca B", product, [])?.confidence,
    ).toBe("uncertain");
    expect(rankProduct("Leche entera", null, product, [])?.confidence).toBe(
      "uncertain",
    );
  });
  it("recognizes an exact description with the same brand", () => {
    expect(
      rankProduct("LECHE ENTERA", "Marca A", product, [])?.confidence,
    ).toBe("high");
    expect(rankProduct("Otra leche", "Marca A", product, [])).toBeNull();
  });
});
