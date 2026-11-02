# Approved records (Step 5.4)

`GET /api/workspaces/{workspaceId}/approved-records?q=...` lists up to 100 approved purchases, newest first, within the authenticated workspace. Search matches merchant, linked product name, original line description, purchase ID, or receipt/manual origin ID. Archived purchases are hidden by default. `includeArchived=true` is owner-only.

`GET /api/workspaces/{workspaceId}/approved-records/{purchaseId}` returns the approved field snapshot, line items, valid product links, allocations and stale flags, source metadata and removal status, approval details, and the caller's role. Source bytes remain behind the existing authorized source endpoint. Archived detail is owner-only; other members receive a safe 404.

The existing inbox, direct review, origin detail, proposal, and source download paths also hide archived approved records from non-owners. Source downloads check visibility at metadata lookup and again before their audit event is committed.

`POST` to the detail path accepts `{ "action": "archive" | "restore", "expectedArchived": boolean }`. It requires owner role, same origin, and a UUID `Idempotency-Key`. State changes and append-only audit events commit together. Same-key retries are safe; a changed payload or stale expected state conflicts. Records are never physically deleted.
