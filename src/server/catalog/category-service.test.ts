import { describe, expect, it } from "vitest";
import { categoryKey } from "./category-service";

describe("category name normalization", () => {
  it("matches accents, case, and spacing without changing display names", () => {
    expect(categoryKey("  HOGAR   y Supermercadó ")).toBe(
      "hogar y supermercado",
    );
  });
});
