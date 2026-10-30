# Receipt intake API (Slice 2.1)

Upload each image or PDF through the private source API first. Then group one
to 20 source IDs into a staged receipt:

`POST /api/workspaces/{workspaceId}/receipts` with a session cookie, same-origin
`Origin`, UUID `Idempotency-Key`, and JSON body
`{"sourceIds":["<source UUID>"]}`. Owner/editor access is required.
The response is `201` for a new staged receipt or `200` for an existing exact
duplicate or retry. It contains `{ receipt: { id, workspaceId, status,
sourceIds, createdAt }, created }`. The source order is retained. Exact
duplicates use an ordered SHA-256 fingerprint of the source content hashes.
The source IDs must be distinct, live, and in the same workspace. A conflicting
idempotency key returns `409`; missing or foreign sources return `404`.

`GET /api/workspaces/{workspaceId}/receipts/{receiptId}` returns the receipt
to any workspace member. Its status may advance through `processing`,
`failed`, `extracted`, and `review` after extraction. A foreign receipt returns
`404`. The request and stored receipt never include storage keys, file bytes,
or financial fields; the read-only proposal has a separate endpoint.
Creating the receipt, its source links, and its append-only audit event is
atomic. No purchase is approved by these endpoints.

The Spanish intake screen is at `/workspaces/{workspaceId}/intake`. It accepts
JPEG, PNG, WebP, PDF, and camera images and groups them in selected order.
The source upload API returns the existing live source for identical content
within a workspace, even with a new request key. Its original metadata is
preserved. A removed source does not prevent a new upload of the same bytes.
The database-backed `pnpm smoke:intake` script verifies upload deduplication,
grouping, retries, invalid cases, workspace scope, and append-only audit.
