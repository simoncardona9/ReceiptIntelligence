import { describe, expect, it } from "vitest";
import type { ReviewFields } from "@/server/review/fields";
import { calculateAllocations } from "./allocation-service";

const fields: ReviewFields = {
  merchant: "Synthetic",
  date: null,
  totalMinor: 1200,
  currency: "UYU",
  subtotalMinor: null,
  discountMinor: null,
  taxMinor: 200,
  taxUnknown: false,
  paymentMethod: null,
  categoryName: "Hogar",
  lineItems: [
    {
      description: "A",
      quantity: null,
      unit: null,
      unitPriceMinor: null,
      discountMinor: null,
      lineTotalMinor: 400,
    },
    {
      description: "B",
      quantity: null,
      unit: null,
      unitPriceMinor: null,
      discountMinor: null,
      lineTotalMinor: 600,
    },
  ],
};
describe("allocation calculation", () => {
  it("splits selected lines and leaves an explicit reconciled remainder without distributing tax", () => {
    const rows = calculateAllocations(fields, 2, "primary", [
      { categoryId: "other", lineIndexes: [0] },
    ]);
    expect(rows.map((row) => row.amountMinor)).toEqual([400, 800]);
    expect(rows[1].lineIndexes).toEqual([]);
    expect(fields.taxMinor).toBe(200);
  });
  it("requires a reason for manual changes and rejects repeated lines", () => {
    expect(() =>
      calculateAllocations(fields, 2, "primary", [
        { categoryId: "other", lineIndexes: [0], overrideAmountMinor: 500 },
      ]),
    ).toThrow();
    expect(() =>
      calculateAllocations(fields, 2, "primary", [
        { categoryId: "other", lineIndexes: [0] },
        { categoryId: "primary", lineIndexes: [0] },
      ]),
    ).toThrow();
  });
  it("rejects over-allocation and absent line amounts", () => {
    expect(() =>
      calculateAllocations(fields, 2, "primary", [
        {
          categoryId: "other",
          lineIndexes: [0],
          overrideAmountMinor: 1300,
          reason: "Manual fix",
        },
      ]),
    ).toThrow();
    expect(() =>
      calculateAllocations(
        {
          ...fields,
          lineItems: [{ ...fields.lineItems[0], lineTotalMinor: null }],
        },
        2,
        "primary",
        [{ categoryId: "other", lineIndexes: [0] }],
      ),
    ).toThrow();
  });
});
