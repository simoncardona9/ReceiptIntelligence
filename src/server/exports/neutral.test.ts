import { describe, expect, it } from "vitest";
import { buildNeutralExport, type ExportPurchase } from "./neutral";

const fields: ExportPurchase["fields"] = {
  merchant: 'A,"B',
  date: "2026-11-05",
  totalMinor: 1234,
  currency: "UYU",
  categoryName: "Food",
  subtotalMinor: 1000,
  taxMinor: 234,
  taxUnknown: false,
  paymentMethod: "cash",
  discountMinor: null,
  lineItems: [
    {
      description: 'Milk,"fresh',
      quantity: "1",
      unit: "unit",
      unitPriceMinor: 1234,
      discountMinor: null,
      taxMinor: null,
      lineTotalMinor: 1234,
    },
  ],
};
const purchase: ExportPurchase = {
  id: "b",
  origin: "receipt",
  originId: "source-1",
  reviewVersion: 2,
  fields,
  products: [
    { lineIndex: 0, productId: "p1", productName: "Milk", brand: null },
  ],
};
const base = { exportId: "export-1", createdAt: "2026-11-05T00:00:00.000Z" };

describe("neutral export contract", () => {
  it("is ordered, deterministic and separates currency totals", () => {
    const usd: ExportPurchase = {
      ...purchase,
      id: "a",
      fields: { ...fields, currency: "USD", totalMinor: 500 },
    };
    const first = buildNeutralExport({ ...base, purchases: [purchase, usd] });
    const second = buildNeutralExport({ ...base, purchases: [usd, purchase] });
    expect(first).toEqual(second);
    expect(first.manifest.currencyTotalsMinor).toEqual({ UYU: 1234, USD: 500 });
    expect(first.json.indexOf('"receiptId":"a"')).toBeLessThan(
      first.json.indexOf('"receiptId":"b"'),
    );
    expect(first.linesCsv).toContain('"Milk,""fresh"');
    expect(first.json).not.toContain("originalFilename");
    expect(first.manifest.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects missing required fields and repeated records", () => {
    expect(() =>
      buildNeutralExport({
        ...base,
        purchases: [
          { ...purchase, fields: { ...fields, paymentMethod: null } },
        ],
      }),
    ).toThrow("payment method");
    expect(() =>
      buildNeutralExport({ ...base, purchases: [purchase, purchase] }),
    ).toThrow("repeated");
    expect(() => buildNeutralExport({ ...base, purchases: [] })).toThrow(
      "Select",
    );
  });
});
