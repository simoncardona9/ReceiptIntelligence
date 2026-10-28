# Business Rules

## Workflow

1. Upload creates a source and staged receipt; it does not create an approved purchase.
2. Extraction creates a proposal and may report warnings or low confidence.
3. A proposal is reviewable only after structural validation completes.
4. Approval requires all mandatory fields and explicit resolution of blocking warnings.
5. Rejection preserves the source and proposal history but excludes it from approved reports.
6. An approved purchase is corrected through a revision, never by erasing evidence.

## Money and dates

- Preserve the source display value and normalized minor-unit value.
- Preserve the receipt currency; never combine currencies implicitly.
- Tax and subtotal must reconcile to the total when all required values are present.
- A mismatch is a review warning or blocking error according to configured severity.
- Receipt date is distinct from upload date and processing date.

## Confidence and evidence

- Confidence belongs to each extracted field where available, not only to the document.
- Missing evidence is not proof that a value is correct.
- Low-confidence or conflicting mandatory fields block approval until resolved.
- User corrections override proposals but retain the proposal value and reason.

## Duplicate handling

- Exact content duplicates are idempotent and must not create a second source record for the same workspace.
- Near-duplicate suggestions are reviewable, never automatically merged.
- A duplicate decision is auditable.

## Sensitive mutations

- Approval, correction, rejection, export, linking, retention changes, and deletion require authorization and audit events.
- Retried mutations use an idempotency key where they can create records or external effects.
- Failed multi-record operations leave no partial approved state.
