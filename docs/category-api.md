# Category catalog (Step 5.1)

`GET /api/workspaces/{workspaceId}/categories` lists workspace categories, including archived entries, and remembered name mappings. `GET` with `?suggest=name` returns up to five active name suggestions and an active confirmed mapping, if any. Suggestions do not mutate data.

`POST` to the same path requires a same-origin request and a UUID `Idempotency-Key` header. Supported bodies are `{ "action": "seed" }`, `{ "action": "create", "name": "...", "parentId": null }`, `{ "action": "map", "sourceName": "...", "categoryId": "uuid" }`, `{ "action": "archive", "categoryId": "uuid" }`, and `{ "action": "merge", "categoryId": "uuid", "targetId": "uuid" }`. Owners and editors may seed, create, and confirm mappings. Only owners may archive or merge. Viewers can read. Seed adapts the expense hierarchy from ProyectoFinanzas' `seedCategories` definition and is explicit and workspace local. It does not connect to ProyectoFinanzas.

Archived categories remain queryable for historical references. Active children must be handled before a parent is archived or merged. Merge redirects confirmed name mappings and records the source category's target. Same-key retries return the same result; a changed payload conflicts. Mutations and their audit events share one transaction. A mapping is never inferred from a suggestion without confirmation.
