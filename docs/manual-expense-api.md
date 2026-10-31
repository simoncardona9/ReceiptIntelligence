# Manual expense intake (Slice 2.3)

Owners and editors create a source-free expense with
`POST /api/workspaces/{workspaceId}/manual-expenses`, a UUID
`Idempotency-Key`, same-origin `Origin`, and JSON fields `merchant`, `date`,
`totalMinor`, `currency` (`UYU` or `USD`), optional `categoryName`, and up to
100 optional `lines`. Each line has `description`, `quantityMilli`, and
`totalMinor`. All money is integer minor units; quantity is integer
thousandths. Validation rejects unsafe, negative, missing, or overlong input.
The Spanish UI accepts decimal pesos or dollars (for example `123,45`) and
converts them to integer `totalMinor` values before calling this API.

The response is `201` for a new expense or `200` for a matching retry. The
stored expense has `origin: "manual"`, `status: "staged"`, and no source or OCR
provenance. A changed payload with the same key returns `409`. Creation,
lines, idempotency record, and append-only audit event commit atomically.
`GET /api/workspaces/{workspaceId}/manual-expenses/{expenseId}` is available
to all workspace members; foreign expense IDs return `404`.

The Spanish creation screen is at
`/workspaces/{workspaceId}/manual-expenses/new`. Step 2 supplies the staged
record and review data shape. Correction, approval, search, and export services
are planned in Steps 4–6 and will use this explicit manual origin.
