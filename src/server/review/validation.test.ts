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
    const current = { ...original, categoryName: "Food" };
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
