# Canonical extraction proposal (Slice 3.4)

Successful local OCR evidence is normalized into a version 1 proposal in the
same transaction that completes its queue job. A proposal is immutable and
remains separate from approved purchases. It cannot be edited, approved, or
exported in Step 3. The receipt moves to `review` only after its evidence,
proposal, job completion, and audit event all commit.

`GET /api/workspaces/{workspaceId}/receipts/{receiptId}/proposal` returns
`{stored:{id,receiptId,jobId,createdAt,proposal}}` to any member of that
workspace. Missing or foreign proposals return `404`. The existing source
review page displays a read-only summary; corrections and full source-region
highlighting belong to Step 4.

`proposal.fields` contains `merchant`, `date`, `totalMinor`, `currency`,
`subtotalMinor`, `taxMinor`, and `paymentMethod`. Each present candidate has
`exact` OCR text, `normalized` value, optional confidence, and evidence with
source ID, page, region ID, and normalized box. Money is integer minor units.
Dates use ISO `YYYY-MM-DD` after strict calendar validation. UYU/USD require
an explicit currency token in OCR evidence; a bare `$` is not assumed to mean
either currency. Quantities use a decimal string and optional unit. Line items
preserve descriptions and any detected quantity, unit price, discount, and
line total. Missing or ambiguous items are left unfilled rather than invented.

`proposal.conflicts` preserves alternative candidates with different
normalized values. `proposal.warnings` lists missing fields, unavailable line
items, and field conflicts. These warnings are informational at this stage;
the financial blocker and approval policy is Slice 4.3. The parser is
deterministic and provider-neutral, with no OCR engine fields in the proposal.
The original provider-neutral page evidence remains in `extraction_evidence`
for later review. Payment-card-like long digit sequences are redacted by the
worker before that evidence is stored; raw provider payloads are not stored.
