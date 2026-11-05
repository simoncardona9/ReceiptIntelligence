import type {
  Proposal,
  ProposalFields,
} from "@/server/extraction/normalization";
import type { ReviewFields } from "./fields";

export type MandatoryField = "merchant" | "totalMinor";
export type ReviewWarning = {
  code: string;
  severity: "financial" | "informational";
  blocksApproval: boolean;
  blocksExport: boolean;
};
export type ReviewValidation = {
  state: "ready" | "blocked";
  warnings: ReviewWarning[];
  reconciliation: {
    itemSumMinor: number | null;
    itemStatus: "match" | "mismatch" | "incomplete" | "no_items";
    netPlusTaxMinor: number | null;
    taxStatus: "match" | "mismatch" | "incomplete";
  };
};

export function evaluateReview(input: {
  current: ReviewFields;
  original: ReviewFields;
  proposal: Proposal | null;
  confirmedFields: MandatoryField[];
}): ReviewValidation {
  const { current, original, proposal, confirmedFields } = input;
  const warnings: ReviewWarning[] = [];
  const add = (
    code: string,
    severity: ReviewWarning["severity"],
    blocksApproval = false,
    blocksExport = false,
  ) => {
    warnings.push({ code, severity, blocksApproval, blocksExport });
  };
  if (!current.merchant) add("MISSING_MERCHANT", "financial", true, true);
  if (current.totalMinor === null)
    add("MISSING_TOTAL", "financial", true, true);
  if (!current.categoryName) add("MISSING_CATEGORY", "financial", true, true);
  for (const field of ["merchant", "totalMinor"] as const) {
    if (
      current[field] === null ||
      current[field] !== original[field] ||
      confirmedFields.includes(field) ||
      !proposal
    )
      continue;
    const candidate = proposal.fields[field] as ProposalFields[typeof field];
    if (proposal.conflicts.some((conflict) => conflict.field === field))
      add(`CONFLICT_${field.toUpperCase()}`, "financial", true, true);
    if (
      candidate &&
      (candidate.confidence === null || candidate.confidence < 0.75)
    )
      add(`LOW_CONFIDENCE_${field.toUpperCase()}`, "financial", true, true);
  }
  if (current.taxUnknown && current.taxMinor !== null)
    add("TAX_STATUS_CONFLICT", "financial", true, true);
  if (
    proposal !== null &&
    !current.taxUnknown &&
    (current.taxMinor === null || current.subtotalMinor === null)
  )
    add("TAX_REVIEW_REQUIRED", "financial", true, true);
  if (
    current.totalMinor !== null &&
    current.subtotalMinor !== null &&
    current.taxMinor !== null &&
    !current.taxUnknown
  ) {
    const reconciled =
      BigInt(current.subtotalMinor) -
      BigInt(current.discountMinor ?? 0) +
      BigInt(current.taxMinor);
    if (reconciled !== BigInt(current.totalMinor))
      add("AMOUNT_MISMATCH", "financial", true, true);
  } else if (current.taxUnknown) add("TAX_UNKNOWN", "informational");
  else add("ARITHMETIC_INCOMPLETE", "informational");
  if (!current.date) add("MISSING_EXPORT_DATE", "informational", false, true);
  if (!current.currency)
    add("MISSING_EXPORT_CURRENCY", "informational", false, true);
  if (!current.paymentMethod)
    add("MISSING_EXPORT_PAYMENT_METHOD", "informational", false, true);
  if (current.lineItems.length === 0) add("UNSPLIT_EXPENSE", "informational");
  else if (current.lineItems.some((line) => line.lineTotalMinor === null))
    add(
      "LINE_ITEMS_INCOMPLETE",
      proposal ? "financial" : "informational",
      proposal !== null,
      proposal !== null,
    );
  const itemSum = current.lineItems.reduce(
    (sum, line) => sum + BigInt(line.lineTotalMinor ?? 0),
    BigInt(0),
  );
  const completeItems =
    current.lineItems.length > 0 &&
    current.lineItems.every((line) => line.lineTotalMinor !== null);
  const itemStatus =
    current.lineItems.length === 0
      ? "no_items"
      : !completeItems || current.totalMinor === null
        ? "incomplete"
        : itemSum === BigInt(current.totalMinor) ||
            itemSum - BigInt(current.discountMinor ?? 0) ===
              BigInt(current.totalMinor) ||
            (!current.taxUnknown &&
              current.taxMinor !== null &&
              itemSum +
                BigInt(current.taxMinor) -
                BigInt(current.discountMinor ?? 0) ===
                BigInt(current.totalMinor))
          ? "match"
          : "mismatch";
  if (itemStatus === "mismatch")
    add("LINE_TOTAL_MISMATCH", "financial", true, true);
  const netPlusTax =
    current.subtotalMinor !== null &&
    current.taxMinor !== null &&
    !current.taxUnknown
      ? BigInt(current.subtotalMinor) -
        BigInt(current.discountMinor ?? 0) +
        BigInt(current.taxMinor)
      : null;
  return {
    state: warnings.some((warning) => warning.blocksApproval)
      ? "blocked"
      : "ready",
    warnings,
    reconciliation: {
      itemSumMinor:
        itemSum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(itemSum) : null,
      itemStatus,
      netPlusTaxMinor:
        netPlusTax !== null && netPlusTax <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(netPlusTax)
          : null,
      taxStatus:
        netPlusTax === null || current.totalMinor === null
          ? "incomplete"
          : netPlusTax === BigInt(current.totalMinor)
            ? "match"
            : "mismatch",
    },
  };
}
