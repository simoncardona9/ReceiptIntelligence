import { z } from "zod";
import type { Proposal } from "@/server/extraction/normalization";
import type { ManualExpense } from "@/server/intake/manual-service";

const money = z.number().int().nonnegative().safe();
export const reviewFieldsSchema = z
  .object({
    merchant: z.string().trim().min(1).max(160).nullable(),
    date: z.iso.date().nullable(),
    totalMinor: money.nullable(),
    currency: z.enum(["UYU", "USD"]).nullable(),
    subtotalMinor: money.nullable(),
    discountMinor: money.nullable(),
    taxMinor: money.nullable(),
    taxUnknown: z.boolean(),
    paymentMethod: z.string().trim().min(1).max(80).nullable(),
    categoryName: z.string().trim().min(1).max(120).nullable(),
    lineItems: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(240),
            quantity: z.string().trim().min(1).max(30).nullable(),
            unit: z.string().trim().min(1).max(20).nullable(),
            unitPriceMinor: money.nullable(),
            discountMinor: money.nullable(),
            lineTotalMinor: money.nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type ReviewFields = z.infer<typeof reviewFieldsSchema>;

export function fieldsFromProposal(proposal: Proposal): ReviewFields {
  const f = proposal.fields;
  return {
    merchant: f.merchant?.normalized ?? null,
    date: f.date?.normalized ?? null,
    totalMinor: f.totalMinor?.normalized ?? null,
    currency: f.currency?.normalized ?? null,
    subtotalMinor: f.subtotalMinor?.normalized ?? null,
    discountMinor: null,
    taxMinor: f.taxMinor?.normalized ?? null,
    taxUnknown: false,
    paymentMethod: f.paymentMethod?.normalized ?? null,
    categoryName: null,
    lineItems: proposal.lineItems.map((line) => ({
      description: line.description.normalized,
      quantity: line.quantity?.normalized ?? null,
      unit: line.unit,
      unitPriceMinor: line.unitPriceMinor?.normalized ?? null,
      discountMinor: line.discountMinor?.normalized ?? null,
      lineTotalMinor: line.lineTotalMinor?.normalized ?? null,
    })),
  };
}

export function fieldsFromManual(expense: ManualExpense): ReviewFields {
  return {
    merchant: expense.merchant,
    date: expense.date,
    totalMinor: expense.totalMinor,
    currency: expense.currency,
    subtotalMinor: null,
    discountMinor: null,
    taxMinor: null,
    taxUnknown: true,
    paymentMethod: null,
    categoryName: expense.categoryName ?? null,
    lineItems: expense.lines.map((line) => ({
      description: line.description,
      quantity: String(line.quantityMilli / 1000),
      unit: null,
      unitPriceMinor: null,
      discountMinor: null,
      lineTotalMinor: line.totalMinor,
    })),
  };
}
