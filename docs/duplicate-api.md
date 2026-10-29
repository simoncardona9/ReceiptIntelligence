# Likely duplicate review (Slice 2.2)

An owner or editor may optionally enter merchant, receipt date, total in minor
units, and currency during receipt intake. These facts are **user-entered
hints**, not OCR evidence or approved financial data. All four fields must be
provided together. Merchant matching folds accents and case and compresses
spaces. Date, amount, and currency must match exactly. Receipts with no hints
have no suggestions until later proposal data is available.

`GET /api/workspaces/{workspaceId}/receipts/{receiptId}/duplicates` lists up to
50 matching receipt IDs and their decision, if any. All workspace members can
read the list. Owners and editors may call
`POST /api/workspaces/{workspaceId}/receipts/{receiptId}/duplicates/{candidateId}`
with `{"decision":"same"}` or `{"decision":"different"}`. The same decision
may be retried; a conflicting decision returns `409`. Both receipt IDs must
belong to the same workspace and match the suggestion criteria. The API never
automatically merges receipts. A `same` decision links the pair while keeping
both receipt records, source links, and histories. Its audit event is append-only.

The Spanish review screen is at
`/workspaces/{workspaceId}/receipts/{receiptId}/duplicates`.
