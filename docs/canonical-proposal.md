# Canonical extraction proposal (Slice 3.4)

Successful local OCR evidence is normalized into a version 1 proposal in the
same transaction that completes its queue job. A proposal is immutable and
remains separate from approved purchases. The immutable proposal itself is
never edited or exported. The receipt moves to `review` only after its evidence,
proposal, job completion, and audit event all commit.

`GET /api/workspaces/{workspaceId}/receipts/{receiptId}/proposal` returns
`{stored:{id,receiptId,jobId,createdAt,proposal}}` to any member of that
workspace. Missing or foreign proposals return `404`. The existing source
review page displays the proposal beside the source. The Step 4 correction API
stores normalized revisions separately, with source-region highlighting.

`proposal.fields` contains `merchant`, `date`, `totalMinor`, `currency`,
`subtotalMinor`, `taxMinor`, and `paymentMethod`. OCR-derived candidates have
`exact` OCR text, `normalized` value, optional confidence, and evidence with
source ID, page, region ID, and normalized box. Money is integer minor units.
Dates use ISO `YYYY-MM-DD` after strict calendar validation. An explicit UYU
or USD token takes precedence. Without one, currency defaults to UYU and the
proposal marks it with `origin: "default"`, null text/confidence/evidence, and
no invented OCR source. A bare `$` does not count as an explicit token.
Quantities use a decimal string and optional unit. Line items
preserve descriptions and any detected quantity, unit price, discount, and
line total. Missing or ambiguous items are left unfilled rather than invented.

When OCR identifies an IVA breakdown, `proposal.taxLines` retains each printed
rate, gross amount, and tax amount with source evidence. The parser computes
receipt-level IVA and net subtotal only when every row has two-decimal amounts,
each tax amount matches its rate against tax-inclusive gross, and gross rows
sum exactly to the receipt total. Calculated candidates have
`origin: "calculated"`, null OCR text/evidence, and `sourceEvidence` links to
the contributing OCR regions. Incomplete or inconsistent rows leave the
receipt-level tax unfilled and produce `TAX_BREAKDOWN_INCOMPLETE` for review.
The proposal read API also returns `taxAnalysis` and `lineAnalysis` derived
from stored OCR evidence for older immutable proposals. This read-only analysis
leaves saved corrections and the original proposal unchanged. Unit prices are
retained only when a separate OCR price and quantity reproduce the printed
line total after rounding. A single-decimal OCR price can be used when this
arithmetic corroborates it; tax-table amounts still require two decimals.

`proposal.conflicts` preserves alternative candidates with different
normalized values. `proposal.warnings` lists missing fields, unavailable line
items, and field conflicts. These warnings are informational at this stage;
the financial blocker and approval policy is defined in [review-api.md](review-api.md). The parser is
deterministic and provider-neutral, with no OCR engine fields in the proposal.
The original provider-neutral page evidence remains in `extraction_evidence`
for later review. Payment-card-like long digit sequences are redacted by the
worker before that evidence is stored; raw provider payloads are not stored.
Review also applies the UYU default to older proposals that have no currency
candidate, without modifying their immutable OCR proposals.
