import { describe, expect, it } from "vitest";
import {
  fieldsFromManual,
  fieldsFromProposal,
  reviewFieldsSchema,
} from "./fields";
import type { Proposal } from "@/server/extraction/normalization";

describe("review fields", () => {
  it("keeps the proposal as evidence while deriving editable normalized fields", () => {
    const evidence = { sourceId: "a", page: 0, regionId: "r", box: null };
    const proposal: Proposal = {
      version: 1,
      fields: {
        merchant: {
          exact: "TIENDA",
          normalized: "Tienda",
          confidence: 0.8,
          evidence,
        },
        date: null,
        totalMinor: {
          exact: "TOTAL 10,00",
          normalized: 1000,
          confidence: 0.9,
          evidence,
        },
        currency: null,
        subtotalMinor: null,
        taxMinor: null,
        paymentMethod: null,
      },
      lineItems: [],
      conflicts: [],
      warnings: [],
    };
    const fields = fieldsFromProposal(proposal);
    expect(fields.merchant).toBe("Tienda");
    expect(fields.totalMinor).toBe(1000);
    expect(proposal.fields.totalMinor?.exact).toBe("TOTAL 10,00");
    expect(fields.taxUnknown).toBe(false);
    expect(reviewFieldsSchema.safeParse(fields).success).toBe(true);
  });

  it("retains manual origin values without receipt evidence", () => {
    const fields = fieldsFromManual({
      id: "m",
      workspaceId: "w",
      origin: "manual",
      status: "staged",
      createdAt: "",
      merchant: "Tienda",
      date: "2026-10-30",
      totalMinor: 1200,
      currency: "UYU",
      lines: [{ description: "Pan", quantityMilli: 1500, totalMinor: 1200 }],
    });
    expect(fields.lineItems[0].quantity).toBe("1.5");
    expect(fields.taxUnknown).toBe(true);
    expect(reviewFieldsSchema.safeParse(fields).success).toBe(true);
  });

  it("rejects negative money, invalid dates, and unknown fields", () => {
    const base = fieldsFromManual({
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
    expect(
      reviewFieldsSchema.safeParse({ ...base, totalMinor: -1 }).success,
    ).toBe(false);
    expect(
      reviewFieldsSchema.safeParse({ ...base, date: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      reviewFieldsSchema.safeParse({ ...base, unexpected: "x" }).success,
    ).toBe(false);
  });
});
