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
