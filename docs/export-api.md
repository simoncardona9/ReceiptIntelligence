# Export center (Slice 6.2)

Owners and editors can use `/workspaces/:workspaceId/exports`. All API calls
require an authenticated membership with edit permission. Requests are scoped
to the workspace; foreign or missing purchase IDs receive a per-record
`PURCHASE_NOT_FOUND` reason in preview, without disclosing the other workspace.

`POST /api/workspaces/:workspaceId/exports/preview` accepts `{purchaseIds,
mode}` with 1–100 distinct approved purchase UUIDs and `mode` of `full` or
`correction`. It returns `ready` records with review version and superseded
batch ID, plus `blocked` records with reason codes. Archived purchases,
financial export warnings, and absent export-required fields are blocked.
Correction mode requires a prior export and a newer approved review version.
Preview does not reserve or mutate records.

`POST /api/workspaces/:workspaceId/exports` accepts the same body and a UUID
`Idempotency-Key`. It checks the current snapshots again, creates one ZIP for
the valid subset, and reports blocked selections separately. An all-blocked
selection returns 409. Repeating the same key and body returns the original
batch; conflicting reuse returns 409. Each batch and its per-record versions
are immutable and retain supersession links. `GET` on the collection lists
history; `GET /api/workspaces/:workspaceId/exports/:exportId` downloads the
original immutable ZIP and records an append-only download audit event.

The ZIP contains `manifest.json`, `purchases.json`, `receipts.csv`, and
`lines.csv`; source files are excluded. The manifest hash covers the three
payload files as documented in [neutral-export.md](neutral-export.md). ZIP
bytes are stored privately with the batch, so later corrections or archive
actions do not rewrite historical exports. Direct delivery is outside this
slice.
