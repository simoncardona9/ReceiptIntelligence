import { describe, expect, it } from "vitest";
import type { Proposal } from "@/server/extraction/normalization";
import { fieldsFromManual, fieldsFromProposal } from "./fields";
import { evaluateReview } from "./validation";

const manual = fieldsFromManual({
  id: "m",
  workspaceId: "w",
  origin: "manual",
  status: "staged",
  createdAt: "",
  merchant: "Tienda",
  date: "2026-10-30",
  totalMinor: 1200,
  currency: "UYU",
  lines: [],
});
function codes(result: ReturnType<typeof evaluateReview>) {
  return result.warnings.map((warning) => warning.code);
}

describe("financial review validation", () => {
  it("blocks missing mandatory values while allowing unknown tax and unsplit expense", () => {
    const blocked = evaluateReview({
      current: { ...manual, categoryName: null },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(blocked.state).toBe("blocked");
    expect(codes(blocked)).toContain("MISSING_CATEGORY");
    const ready = evaluateReview({
      current: { ...manual, categoryName: "Food" },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(ready.state).toBe("ready");
    expect(codes(ready)).toContain("TAX_UNKNOWN");
    expect(codes(ready)).toContain("UNSPLIT_EXPENSE");
    expect(
      ready.warnings.find(
        (warning) => warning.code === "MISSING_EXPORT_PAYMENT_METHOD",
      )?.blocksExport,
    ).toBe(true);
  });

  it("reconciles exact integer minor amounts and never ignores a mismatch", () => {
    const fields = {
      ...manual,
      categoryName: "Food",
      totalMinor: 1200,
      subtotalMinor: 1000,
      discountMinor: 100,
      taxMinor: 300,
      taxUnknown: false,
    };
    expect(
      evaluateReview({
        current: fields,
        original: manual,
        proposal: null,
        confirmedFields: [],
      }).state,
    ).toBe("ready");
    const mismatch = evaluateReview({
      current: { ...fields, totalMinor: 1201 },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(mismatch.state).toBe("blocked");
    expect(
      mismatch.warnings.find((warning) => warning.code === "AMOUNT_MISMATCH")
        ?.severity,
    ).toBe("financial");
    expect(
      codes(
        evaluateReview({
          current: { ...fields, taxUnknown: true },
          original: manual,
          proposal: null,
          confirmedFields: [],
        }),
      ),
    ).toContain("TAX_STATUS_CONFLICT");
  });

  it("checks saved item totals against receipt total before approval", () => {
    const item = (description: string, amount: number) => ({
      description,
      quantity: null,
      unit: null,
      unitPriceMinor: null,
      discountMinor: null,
      lineTotalMinor: amount,
    });
    const fields = {
      ...manual,
      categoryName: "Food",
      lineItems: [item("Arroz", 700), item("Carne", 500)],
    };
    const matching = evaluateReview({
      current: fields,
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(matching.reconciliation.itemStatus).toBe("match");
    expect(matching.reconciliation.pricedItemCount).toBe(2);
    expect(matching.reconciliation.missingItemCount).toBe(0);
    expect(matching.reconciliation.differenceMinor).toBe(0);
    const partial = evaluateReview({
      current: {
        ...fields,
        lineItems: [
          item("Arroz", 700),
          { ...item("Carne", 500), lineTotalMinor: null },
        ],
      },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(partial.reconciliation).toMatchObject({
      itemSumMinor: 700,
      pricedItemCount: 1,
      missingItemCount: 1,
      differenceMinor: 500,
      itemStatus: "incomplete",
    });
    const priced = evaluateReview({
      current: {
        ...fields,
        lineItems: [
          { ...item("Arroz", 700), quantity: "2", unitPriceMinor: 350 },
          { ...item("Carne", 500), quantity: "0.500", unitPriceMinor: 1000 },
        ],
      },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(priced.reconciliation.unitPriceMismatchLines).toEqual([]);
    const wrongUnitPrice = evaluateReview({
      current: {
        ...fields,
        lineItems: [
          item("Arroz", 700),
          { ...item("Carne", 500), quantity: "0.500", unitPriceMinor: 900 },
        ],
      },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(wrongUnitPrice.reconciliation.unitPriceMismatchLines).toEqual([2]);
    expect(codes(wrongUnitPrice)).toContain("LINE_UNIT_PRICE_MISMATCH");
    const mismatch = evaluateReview({
      current: {
        ...fields,
        lineItems: [item("Arroz", 700), item("Carne", 400)],
      },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(mismatch.reconciliation.itemSumMinor).toBe(1100);
    expect(mismatch.reconciliation.differenceMinor).toBe(100);
    expect(mismatch.reconciliation.itemStatus).toBe("mismatch");
    const over = evaluateReview({
      current: {
        ...fields,
        lineItems: [item("Arroz", 700), item("Carne", 600)],
      },
      original: manual,
      proposal: null,
      confirmedFields: [],
    });
    expect(over.reconciliation.differenceMinor).toBe(-100);
    expect(mismatch.warnings).toContainEqual(
      expect.objectContaining({
        code: "LINE_TOTAL_MISMATCH",
        blocksApproval: true,
      }),
    );
  });

  it("requires user resolution when a printed IVA breakdown is incomplete", () => {
    const evidence = { sourceId: "s", page: 0, regionId: "tax", box: null };
    const proposal: Proposal = {
      version: 1,
      fields: {
        merchant: null,
        date: null,
        totalMinor: null,
        currency: null,
        subtotalMinor: null,
        taxMinor: null,
        paymentMethod: null,
      },
      lineItems: [],
      taxLines: [
        {
          ratePercent: 10,
          label: {
            exact: "IVA MINIMO 10%",
            normalized: "IVA MINIMO 10%",
            confidence: 0.9,
            evidence,
          },
          grossMinor: null,
          taxMinor: null,
        },
      ],
      conflicts: [],
      warnings: ["TAX_BREAKDOWN_INCOMPLETE"],
    };
    const current = { ...manual, categoryName: "Food", taxUnknown: false };
    const blocked = evaluateReview({
      current,
      original: current,
      proposal,
      confirmedFields: [],
    });
    expect(codes(blocked)).toContain("TAX_REVIEW_REQUIRED");
    expect(blocked.state).toBe("blocked");
    const acknowledged = evaluateReview({
      current: { ...current, taxUnknown: true },
      original: current,
      proposal,
      confirmedFields: [],
    });
    expect(codes(acknowledged)).not.toContain("TAX_REVIEW_REQUIRED");
    const corrected = evaluateReview({
      current: { ...current, subtotalMinor: 1000, taxMinor: 200 },
      original: current,
      proposal,
      confirmedFields: [],
    });
    expect(corrected.reconciliation.taxStatus).toBe("match");
    expect(corrected.state).toBe("ready");
    const missingItemPrice = evaluateReview({
      current: {
        ...current,
        taxUnknown: true,
        lineItems: [
          {
            description: "Arroz",
            quantity: null,
            unit: null,
            unitPriceMinor: null,
            discountMinor: null,
            lineTotalMinor: null,
          },
        ],
      },
      original: current,
      proposal,
      confirmedFields: [],
    });
    expect(missingItemPrice.state).toBe("blocked");
    expect(codes(missingItemPrice)).toContain("LINE_ITEMS_INCOMPLETE");
  });

  it("requires correction or reasoned confirmation for conflicting low-confidence mandatory OCR", () => {
    const evidence = { sourceId: "s", page: 0, regionId: "r", box: null };
    const proposal: Proposal = {
      version: 1,
      fields: {
        merchant: {
          exact: "MERCADO",
          normalized: "Mercado",
          confidence: 0.5,
          evidence,
        },
        date: null,
        totalMinor: {
          exact: "TOTAL 10,00",
          normalized: 1000,
          confidence: 0.4,
          evidence,
        },
        currency: null,
        subtotalMinor: null,
        taxMinor: null,
        paymentMethod: null,
      },
      lineItems: [],
      warnings: [],
      conflicts: [
        {
          field: "totalMinor",
          alternatives: [
            {
              exact: "TOTAL 11,00",
              normalized: 1100,
              confidence: 0.4,
              evidence,
            },
          ],
        },
      ],
    };
    const original = fieldsFromProposal(proposal);
    const current = { ...original, categoryName: "Food", taxUnknown: true };
    const blocked = evaluateReview({
      current,
      original,
      proposal,
      confirmedFields: [],
    });
    expect(blocked.state).toBe("blocked");
    expect(codes(blocked)).toContain("CONFLICT_TOTALMINOR");
    expect(codes(blocked)).toContain("LOW_CONFIDENCE_MERCHANT");
    expect(
      evaluateReview({
        current,
        original,
        proposal,
        confirmedFields: ["merchant", "totalMinor"],
      }).state,
    ).toBe("ready");
    expect(
      evaluateReview({
        current: {
          ...current,
          merchant: "Mercado confirmado",
          totalMinor: 1100,
        },
        original,
        proposal,
        confirmedFields: [],
      }).state,
    ).toBe("ready");
  });
});
