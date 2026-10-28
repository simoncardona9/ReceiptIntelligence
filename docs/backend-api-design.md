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

Initial contract candidates, to be finalized per slice:

Authentication and workspace contracts are defined in
[auth-api.md](auth-api.md). These endpoints keep identity and membership writes
inside transactional application services; session cookies are opaque and
workspace selection is validated against the caller's memberships.

- `POST /api/v1/receipts` — upload/stage a source.
- `POST /api/v1/receipts/{id}/extraction-runs` — request extraction.
- `GET /api/v1/receipts/{id}` — source, proposal, review state, and safe evidence.
- `PATCH /api/v1/receipts/{id}/proposal` — submit corrections with reason/version.
- `POST /api/v1/receipts/{id}/approve` — approve atomically and idempotently.
- `POST /api/v1/receipts/{id}/reject` — reject with reason.
- `GET /api/v1/purchases` — authorized search and currency-separated results.

Use UUID identifiers, ISO dates, explicit minor-unit money plus currency, stable
error codes, bounded pagination, optimistic version checks, and consistent
authorization/error mapping.
