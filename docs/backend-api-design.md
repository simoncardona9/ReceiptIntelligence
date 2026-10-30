# Backend API and Layered Design

```text
HTTP route/controller
  -> request schema and authorization
  -> application service
  -> domain rules
  -> repository/object-storage port
  -> PostgreSQL or private object storage
```

Suggested feature modules:

```text
src/modules/
  auth/
  workspaces/
  receipts/
    intake/
    extraction/
    review/
    approval/
  purchases/
  reports/
src/shared/
  auth/ errors/ audit/ money/ dates/ storage/
```

Routes call one service and contain no SQL or business calculations. Services
receive authenticated workspace scope explicitly. Repositories perform only
scoped persistence. Extraction adapters return canonical proposals and never
perform approval or reporting writes.

Replaceable infrastructure ports:

```text
Application service
  -> ReceiptExtractionPort
  -> ReceiptRepository / AuditRepository / UnitOfWork
  -> ObjectStoragePort
        |                 |                 |
  OCR worker       PostgreSQL/Drizzle     local/private storage
```

Services and domain rules must not import OCR libraries, ORM models, database
drivers, or object-storage SDKs. Adapters translate those systems into
provider-neutral domain contracts.

## Implemented contracts through Step 3

Routes use `/api/workspaces/{workspaceId}` for workspace-scoped operations.
Authentication and workspace contracts are in [auth-api.md](auth-api.md);
session cookies are opaque, and workspace selection is checked against the
caller's memberships. Current resource contracts are:

- [source-api.md](source-api.md): upload, private download, and removal.
- [receipt-intake-api.md](receipt-intake-api.md): staged receipt creation and
  scoped receipt read.
- [duplicate-api.md](duplicate-api.md), [manual-expense-api.md](manual-expense-api.md),
  and [inbox-api.md](inbox-api.md): Step 2 review and navigation.
- [extraction-queue-api.md](extraction-queue-api.md): submit and control local
  extraction jobs, plus queue status.
- [canonical-proposal.md](canonical-proposal.md): read the unapproved proposal
  for a receipt in `review`.
- [review-api.md](review-api.md): read normalized review state, append reasoned corrections, and approve or reject.

Purchase search contracts will be defined in Step 5. No `/api/v1/receipts` or
`/api/v1/purchases` routes are implemented.

Use UUID identifiers, ISO dates, explicit minor-unit money plus currency, stable
error codes, bounded pagination, optimistic version checks, and consistent
authorization/error mapping.
