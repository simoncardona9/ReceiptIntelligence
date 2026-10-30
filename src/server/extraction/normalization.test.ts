import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "./contracts";
import {
  normalizeExtraction,
  parseMoneyMinor,
  parseReceiptDate,
} from "./normalization";

const SOURCE = "a839325b-4d06-4a18-ab0e-43bb05615071";
function evidence(lines: string[]): ExtractionResult {
  return {
    version: 1,
    engine: "tesseract",
    device: "cpu",
    diagnostics: { durationMs: 10 },
    pages: [
      {
        sourceId: SOURCE,
        page: 0,
        width: 960,
        height: 1000,
        regions: lines.map((text, index) => ({
          id: String(index),
          text,
          confidence: 0.9,
          box: [0.1, index / 40, 0.8, (index + 1) / 40],
        })),
      },
    ],
  };
}

describe("Spanish canonical normalization", () => {
  it("parses money in minor units without floating point", () => {
    expect(parseMoneyMinor("TOTAL UYU $ 1.350,00")).toBe(135000);
    expect(parseMoneyMinor("USD 45.00")).toBe(4500);
    expect(parseMoneyMinor("$ 89,5")).toBe(8950);
    expect(parseMoneyMinor("-12,00")).toBeNull();
    expect(parseMoneyMinor("TOTAL $ 999999999999999999,99")).toBeNull();
  });

  it("parses valid local dates and rejects impossible ones", () => {
    expect(parseReceiptDate("FECHA 29/10/2026")).toBe("2026-10-29");
    expect(parseReceiptDate("2026-10-29")).toBe("2026-10-29");
    expect(parseReceiptDate("31/02/2026")).toBeNull();
  });

  it("keeps exact text, field evidence, confidence, and line items", () => {
    const proposal = normalizeExtraction(
      evidence([
        "MERCADO SOL DEL SUR",
        "29/10/2026",
        "ARROZ BLANCO 1 KG",
        "2 UN",
        "$ 89,00",
        "$ 178,00",
        "LECHE ENTERA 1 L",
        "1 UN",
        "$ 65,00",
        "SUBTOTAL $ 243,00",
        "IVA INCLUIDO $ 25,55",
        "TOTAL UYU $ 243,00",
        "TARJETA DEBITO",
      ]),
    );
    expect(proposal.fields.merchant?.exact).toBe("MERCADO SOL DEL SUR");
    expect(proposal.fields.totalMinor?.normalized).toBe(24300);
    expect(proposal.fields.totalMinor?.evidence).toMatchObject({
      sourceId: SOURCE,
      page: 0,
      regionId: "11",
    });
    expect(proposal.fields.currency?.normalized).toBe("UYU");
    expect(proposal.fields.paymentMethod?.normalized).toBe("debit_card");
    expect(proposal.lineItems).toHaveLength(2);
    expect(proposal.lineItems[0]).toMatchObject({
      description: { exact: "ARROZ BLANCO 1 KG" },
      quantity: { normalized: "2" },
      unit: "UN",
      unitPriceMinor: { normalized: 8900 },
      lineTotalMinor: { normalized: 17800 },
    });
    expect(proposal.conflicts).toHaveLength(0);
  });

  it("preserves conflicting totals and explicit missing warnings", () => {
    const proposal = normalizeExtraction(
      evidence([
        "BISTRO DEL PUERTO",
        "TOTAL UYU $ 800,00",
        "TOTAL UYU $ 810,00",
      ]),
    );
    expect(proposal.fields.totalMinor?.normalized).toBe(80000);
    expect(proposal.conflicts[0]).toMatchObject({ field: "totalMinor" });
    expect(
      proposal.conflicts[0].alternatives.map((item) => item.normalized),
    ).toEqual([80000, 81000]);
    expect(proposal.warnings).toContain("FIELD_CONFLICT");
    expect(proposal.warnings).toContain("MISSING_DATE");
    expect(proposal.warnings).toContain("LINE_ITEMS_UNAVAILABLE");
  });

  it("does not copy a long card number into a proposal", () => {
    const proposal = normalizeExtraction(
      evidence([
        "BISTRO DEL PUERTO",
        "TARJETA 4111 1111 1111 1111",
        "TOTAL UYU $ 10,00",
      ]),
    );
    expect(JSON.stringify(proposal)).not.toContain("4111");
  });
});
