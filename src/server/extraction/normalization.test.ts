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

  it("defaults an unspecified currency to UYU without inventing OCR evidence", () => {
    const proposal = normalizeExtraction(
      evidence(["MERCADO DEL BARRIO", "TOTAL $ 299,00"]),
    );
    expect(proposal.fields.currency).toEqual({
      normalized: "UYU",
      origin: "default",
      exact: null,
      confidence: null,
      evidence: null,
    });
    expect(proposal.warnings).not.toContain("MISSING_CURRENCY");
  });

  it("uses an explicit USD token instead of the UYU default", () => {
    const proposal = normalizeExtraction(
      evidence(["MERCADO DEL BARRIO", "TOTAL USD 10,00"]),
    );
    expect(proposal.fields.currency?.normalized).toBe("USD");
    expect(proposal.fields.currency?.evidence?.regionId).toBe("1");
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

  it("associates split receipt columns and preserves products with unreadable prices", () => {
    const rows: [string, number, number][] = [
      ["MERCADO DEL BARRIO", 0.1, 0.1],
      ["04/11/2026", 0.1, 0.14],
      ["CONSUMO FINAL", 0.1, 0.2],
      ["ARROZ 1 KG", 0.1, 0.25],
      ["89,00", 0.75, 0.252],
      ["CARNE KG", 0.1, 0.29],
      ["0,500Kg X", 0.25, 0.311],
      ["420,0", 0.5, 0.312],
      ["210,00", 0.75, 0.313],
      ["LECHE 1 L", 0.1, 0.35],
      ["6?,00", 0.75, 0.351],
      ["TOTAL", 0.1, 0.4],
      ["299,00", 0.75, 0.402],
      ["VENCIMIENTO 21/06/2028", 0.1, 0.8],
    ];
    const input = evidence(rows.map(([text]) => text));
    input.pages[0].regions = rows.map(([text, x, y], index) => ({
      id: String(index),
      text,
      confidence: 0.9,
      box: [x, y, Math.min(x + 0.12, 0.99), y + 0.01],
    }));
    const proposal = normalizeExtraction(input);
    expect(proposal.fields.totalMinor?.normalized).toBe(29900);
    expect(proposal.fields.date?.normalized).toBe("2026-11-04");
    expect(
      proposal.conflicts.some((conflict) => conflict.field === "date"),
    ).toBe(false);
    expect(proposal.lineItems).toHaveLength(3);
    expect(
      proposal.lineItems.map((line) => line.lineTotalMinor?.normalized),
    ).toEqual([8900, 21000, undefined]);
    expect(proposal.lineItems[1].quantity?.normalized).toBe("0.500");
    expect(proposal.lineItems[1].unit).toBe("KG");
    expect(proposal.lineItems[1].unitPriceMinor?.normalized).toBe(42000);
    expect(proposal.warnings).toContain("LINE_ITEMS_INCOMPLETE");
    input.pages[0].regions[7].text = "400,00";
    expect(normalizeExtraction(input).lineItems[1].unitPriceMinor).toBeNull();
  });

  it("uses complete OCR IVA rows only when tax math and gross totals reconcile", () => {
    const rows: [string, number, number][] = [
      ["MERCADO DEL BARRIO", 0.1, 0.1],
      ["TOTAL", 0.1, 0.5],
      ["2203,19", 0.75, 0.501],
      ["Detalle de Impuestos", 0.1, 0.55],
      ["IVA BASICO 22%", 0.1, 0.6],
      ["806,00", 0.5, 0.601],
      ["145,34", 0.75, 0.602],
      ["IVA EXENTO 0%", 0.1, 0.63],
      ["1335,19", 0.5, 0.631],
      ["0,00", 0.75, 0.632],
      ["IVA MINIMO 10%", 0.1, 0.66],
      ["62,00", 0.5, 0.661],
      ["5,64", 0.75, 0.662],
    ];
    const input = evidence(rows.map(([text]) => text));
    input.pages[0].regions = rows.map(([text, x, y], index) => ({
      id: String(index),
      text,
      confidence: 0.9,
      box: [x, y, x + 0.12, y + 0.01],
    }));
    const valid = normalizeExtraction(input);
    expect(valid.taxLines).toHaveLength(3);
    expect(valid.fields.taxMinor).toMatchObject({
      normalized: 15098,
      origin: "calculated",
    });
    expect(
      valid.fields.taxMinor && "sourceEvidence" in valid.fields.taxMinor
        ? valid.fields.taxMinor.sourceEvidence.map((item) => item.regionId)
        : null,
    ).toEqual(["4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(valid.fields.subtotalMinor?.normalized).toBe(205221);
    input.pages[0].regions.push({
      id: "13",
      text: "IVA TOTAL $ 149,00",
      confidence: 0.9,
      box: [0.1, 0.72, 0.5, 0.73],
    });
    const conflicting = normalizeExtraction(input);
    expect(conflicting.fields.taxMinor?.normalized).toBe(14900);
    expect(conflicting.warnings).toContain("TAX_BREAKDOWN_MISMATCH");
    input.pages[0].regions.pop();
    input.pages[0].regions[12].text = "5,4";
    const uncertain = normalizeExtraction(input);
    expect(uncertain.fields.taxMinor).toBeNull();
    expect(uncertain.warnings).toContain("TAX_BREAKDOWN_INCOMPLETE");
  });
});
