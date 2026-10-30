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
unsplit expense warning permits approval without usable line items. Approval
and export endpoints will enforce these flags in later slices.
