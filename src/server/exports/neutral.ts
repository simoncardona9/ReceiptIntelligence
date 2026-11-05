import { createHash } from "node:crypto";
import { DomainError } from "@/server/auth/contracts";
import type { ReviewFields } from "@/server/review/fields";

export const NEUTRAL_SCHEMA_VERSION = "1.0.0";

export type ExportPurchase = {
  id: string;
  origin: "receipt" | "manual";
  originId: string;
  reviewVersion: number;
  fields: ReviewFields;
  products: {
    lineIndex: number;
    productId: string;
    productName: string;
    brand: string | null;
  }[];
};

function required(value: string | number | null, field: string) {
  if (value === null || value === "")
    throw new DomainError(
      "EXPORT_FIELD_MISSING",
      409,
      `Export requires ${field}.`,
    );
  return value;
}

function csvCell(value: unknown): string {
  const string = value === null || value === undefined ? "" : String(value);
  return `"${string.replaceAll('"', '""')}"`;
}

function csv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function buildNeutralExport(input: {
  exportId: string;
  createdAt: string;
  purchases: ExportPurchase[];
}) {
  if (!input.purchases.length)
    throw new DomainError("EXPORT_EMPTY", 400, "Select at least one purchase.");
  const ids = new Set<string>();
  const totals = { UYU: 0, USD: 0 };
  const records = [...input.purchases]
    .sort((a, b) => a.id.localeCompare(b.id, "en"))
    .map((purchase) => {
      if (ids.has(purchase.id))
        throw new DomainError(
          "EXPORT_DUPLICATE",
          400,
          "Purchase selection is repeated.",
        );
      ids.add(purchase.id);
      const f = purchase.fields;
      const currency = required(f.currency, "currency");
      if (currency !== "UYU" && currency !== "USD")
        throw new DomainError(
          "EXPORT_CURRENCY_INVALID",
          409,
          "Unsupported currency.",
        );
      const totalMinor = required(f.totalMinor, "total");
      totals[currency] += totalMinor as number;
      if (!Number.isSafeInteger(totals[currency]))
        throw new DomainError(
          "EXPORT_TOTAL_OVERFLOW",
          409,
          "Currency total is too large.",
        );
      const products = new Map(purchase.products.map((p) => [p.lineIndex, p]));
      return {
        receiptId: purchase.id,
        origin: purchase.origin,
        originId: purchase.originId,
        reviewVersion: purchase.reviewVersion,
        merchant: required(f.merchant, "merchant"),
        date: required(f.date, "date"),
        totalMinor,
        currency,
        category: required(f.categoryName, "category"),
        subtotalMinor: required(f.subtotalMinor, "subtotal"),
        taxMinor: required(f.taxMinor, "tax"),
        paymentMethod: required(f.paymentMethod, "payment method"),
        discountMinor: f.discountMinor,
        lineItems: f.lineItems.map((line, index) => ({
          lineIndex: index,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceMinor: line.unitPriceMinor,
          discountMinor: line.discountMinor,
          taxMinor: line.taxMinor ?? null,
          lineTotalMinor: line.lineTotalMinor,
          productId: products.get(index)?.productId ?? null,
          productName: products.get(index)?.productName ?? null,
          brand: products.get(index)?.brand ?? null,
        })),
      };
    });
  const json =
    JSON.stringify({ schemaVersion: NEUTRAL_SCHEMA_VERSION, records }) + "\n";
  const receiptsCsv = csv([
    [
      "receiptId",
      "origin",
      "originId",
      "reviewVersion",
      "merchant",
      "date",
      "totalMinor",
      "currency",
      "category",
      "subtotalMinor",
      "taxMinor",
      "paymentMethod",
      "discountMinor",
    ],
    ...records.map((r) => [
      r.receiptId,
      r.origin,
      r.originId,
      r.reviewVersion,
      r.merchant,
      r.date,
      r.totalMinor,
      r.currency,
      r.category,
      r.subtotalMinor,
      r.taxMinor,
      r.paymentMethod,
      r.discountMinor,
    ]),
  ]);
  const linesCsv = csv([
    [
      "receiptId",
      "lineIndex",
      "description",
      "quantity",
      "unit",
      "unitPriceMinor",
      "discountMinor",
      "taxMinor",
      "lineTotalMinor",
      "productId",
      "productName",
      "brand",
    ],
    ...records.flatMap((r) =>
      r.lineItems.map((line) => [
        r.receiptId,
        line.lineIndex,
        line.description,
        line.quantity,
        line.unit,
        line.unitPriceMinor,
        line.discountMinor,
        line.taxMinor,
        line.lineTotalMinor,
        line.productId,
        line.productName,
        line.brand,
      ]),
    ),
  ]);
  const contentHash = createHash("sha256")
    .update(json)
    .update(receiptsCsv)
    .update(linesCsv)
    .digest("hex");
  return {
    manifest: {
      exportId: input.exportId,
      schemaVersion: NEUTRAL_SCHEMA_VERSION,
      createdAt: input.createdAt,
      recordCount: records.length,
      currencyTotalsMinor: totals,
      contentHashAlgorithm: "sha256" as const,
      contentHash,
    },
    json,
    receiptsCsv,
    linesCsv,
  };
}
