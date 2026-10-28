# Technology Stack Decision

## Initial decision

Use TypeScript for the UI and API, PostgreSQL for structured data, private
object storage for receipt files, and a modular monolith for the first release.

| Area | Decision | Reason |
|---|---|---|
| UI/API | TypeScript | Shared types and validation |
| UI | React with Next.js App Router | Responsive web application |
| Runtime | Node.js | Same ecosystem for UI and server |
| API | REST/JSON route handlers | Simple, explicit client boundary |
| Database | PostgreSQL | Constraints, transactions, search, reporting |
| Data access | Drizzle ORM or equivalent typed SQL layer | Explicit schema and migrations |
| Validation | Zod or equivalent | Shared runtime validation |
| Tests | Vitest and React Testing Library | Fast unit/component coverage |
| Local runtime | Docker Compose | Reproducible services |
| Extraction worker | Python, isolated local worker | PaddleOCR/Tesseract and document-processing ecosystem |

## Extraction provider decision

Receipt processing must remain local/private. Version 1 uses OCR and
rule-based parsing with an optional locally hosted AI/document model. CPU is
the baseline and optional GPU acceleration is supported. The extraction
boundary remains replaceable so local engines can be evaluated without changing
the approved domain model.

The current candidate is PaddleOCR as the primary adapter, with Tesseract as a
fallback/benchmark. See [ocr-evaluation.md](ocr-evaluation.md). This is a
provisional implementation choice until the receipt benchmark is complete.

## Replaceability requirements

- Domain services consume `ReceiptExtractionPort`, not PaddleOCR/Tesseract APIs.
- Domain services consume repository and unit-of-work ports, not Drizzle query
  builders or PostgreSQL-specific result types.
- The first database adapter is PostgreSQL/Drizzle. A future adapter may use a
  different relational database after compatibility, migration, transaction,
  indexing, and reporting checks are documented.
- Database migrations are versioned per adapter and require a migration and
  rollback/reconciliation plan before changing persistence technology.
- Business-rule tests use in-memory fakes or repository contracts where
  possible; adapter tests separately verify PostgreSQL/Drizzle behavior.
- Export schemas and approved-domain records are independent of OCR-provider
  response formats and database table names.

## Explicit non-decisions

- No microservices in version 1.
- No browser-direct database access.
- No provider-specific fields in the approved domain model.
- No production provider credentials in the repository.
- Cloud host, object-storage vendor, and CI platform are deferred until the
  first deployment slice is approved.
