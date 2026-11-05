# Review and correction API

`GET /api/workspaces/:workspaceId/review/:origin/:originId` reads the current
review and immutable revision history. `origin` is `receipt` or `manual`. The
first read derives version `0` from the immutable receipt proposal or original
manual expense and makes no database change. The response has `review.original`,
`review.current`, `review.version`, `review.baseProposalId`, and `review.revisions`.
Receipt original text, confidence, and regions remain in the proposal endpoint.

`PATCH` on the same URL is for owners and editors. It requires same-origin
request headers, a UUID `Idempotency-Key`, and JSON with `expectedVersion`,
`expectedBaseProposalId`, a 3–500 character `reason`, and a complete normalized
`fields` object. A receipt correction must identify the proposal from its GET
response; a manual correction uses `null`. Optional fields are `null`, not
omitted. Money is integer minor units. `lineItems` supports at most 200 lines.
The review UI displays and accepts decimal pesos or dollars while this contract
continues to use integer centésimos.

Each successful correction updates the current version, inserts an immutable
before/after revision with actor and reason, and appends a content-free audit
event in one transaction. Replaying the same key and body returns the current
review without creating another revision. A changed payload for that key,
stale version, or changed source proposal returns `409`. Viewers cannot write;
unknown workspace and foreign records return safe errors. Raw receipt text is
never logged by these endpoints.

## Validation and warning policy

The GET response includes `review.validation.state` (`ready` or `blocked`) and
deterministic warnings. Each warning has a code, `financial` or `informational`
severity, and independent `blocksApproval` and `blocksExport` flags. Missing
merchant, total, or category; a conflicting or low-confidence mandatory OCR
value; a tax-status contradiction; and arithmetic mismatch block approval.
Low confidence means below 0.75 or no confidence value. A changed normalized
value resolves its OCR conflict; alternatively, PATCH may include
`confirmFields: ["merchant", "totalMinor"]` with a reason. Confirmations are
versioned and audited even if the normalized value is unchanged.

If subtotal, tax, and total are known and tax is not marked unknown, validation
requires `subtotalMinor - (discountMinor ?? 0) + taxMinor === totalMinor` using
integer arithmetic. Unknown tax, missing arithmetic inputs, and unavailable
line items are visible informational warnings. Date, currency, and payment
method may be missing for approval, while their absence blocks export. The
unsplit expense warning permits approval without usable line items. The
approval endpoint enforces these blockers. Export remains a later step.

The review response also reports the saved item sum and the net-minus-discount
plus IVA calculation beside the receipt total. Receipt item totals must be
complete and reconcile with the receipt total, allowing either tax-inclusive
line prices or net line prices plus explicit tax; missing prices and mismatches
block approval. For a receipt,
the user must supply both IVA and net subtotal or explicitly mark IVA unknown
before approval. The review page shows the OCR tax rows and lets the user inspect their source
regions. All amounts remain editable through versioned corrections.
The editor suggests net subtotal as total minus IVA plus discount after a user
enters or confirms IVA. Applying the suggestion updates only the draft; saving
it creates the normal auditable correction.
The proposal GET response includes `taxAnalysis` from the stored OCR evidence
for older proposals, so existing saved reviews can inspect IVA rows without
reprocessing or replacing their corrections.

## Approval lifecycle

`POST /api/workspaces/:workspaceId/review/:origin/:originId/lifecycle` accepts
`expectedVersion`, `expectedBaseProposalId`, and one decision: `{"action":"approve"}`,
`{"action":"reject","reason":"..."}`, or `{"action":"auto","enabled":true|false}`.
It requires same-origin headers and a UUID idempotency key. Owners and editors
can approve and reject; only owners can select per-record automatic approval.
Approval returns `409 APPROVAL_BLOCKED` while financial blockers remain.
Rejection is permanent for that proposal. A receipt can receive a new OCR
proposal through the explicit reprocess action while its review has no
corrections; that action reopens a rejected review and audits the change.
Choosing auto approval on a blocked review records the
choice; a later valid correction creates the approved purchase in the same
transaction as that correction. An auto choice on a ready review approves
immediately.

Approved purchases are separate, workspace-scoped snapshots linked to one
receipt or manual origin. Their approval mode, actor, time, and review version
are retained. A valid correction after approval appends a revision and audit
event while updating the approved snapshot atomically. A correction that would
introduce a financial blocker is rejected. Receipt proposal evidence and
original manual values remain unchanged. Replaying an action cannot create a
second purchase; lifecycle request and event records are immutable. Export is
outside Step 4.
