# Product catalog (Step 5.2)

`GET /api/workspaces/{workspaceId}/products` lists workspace products. `?suggest=description&brand=name` returns exact-name or previously linked exact-description matches with `high` or `uncertain` confidence. A brand difference or an unverified brand is uncertain. `?purchaseId=uuid` returns the current approved line descriptions and valid product links; links from an older review version are hidden until reconfirmed.

`POST` requires same origin, owner/editor role, and a UUID `Idempotency-Key`. Actions are `create` (`name`, nullable `brand`), `rename` (`productId`, `name`, nullable `brand`), and `link` (`purchaseId`, `lineIndex`, `productId`, nullable `brand`, `expectedReviewVersion`, `confirmUncertain`). Linking a line without a high-confidence match requires `confirmUncertain: true`. The service verifies workspace membership, the approved purchase, the current review version, and line index in one transaction. Original descriptions remain in the approved purchase fields and in the line link. Product identity does not alter export data.

Every mutation writes an audit event and retry record atomically. Changed-payload key reuse returns a conflict. Viewers may read but cannot mutate.
