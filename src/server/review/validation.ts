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
    add("LINE_ITEMS_INCOMPLETE", "informational");
  return {
    state: warnings.some((warning) => warning.blocksApproval)
      ? "blocked"
      : "ready",
    warnings,
  };
}
