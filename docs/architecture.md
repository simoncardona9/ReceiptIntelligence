# Architecture

## Recommended shape

Start with one deployable modular web application, a relational database, and
private object storage for source files. Keep OCR engines, database access, and
object storage behind replaceable ports/adapters so infrastructure changes do
not alter the review, approval, export, or domain model.

```text
Browser / mobile web
        |
UI and API boundary
        |
Authentication + workspace authorization
        |
Receipt intake -> extraction adapter -> proposal/review workflow
        |
Approved purchase model and reports
        |
PostgreSQL + private object storage + audit history
```

## Boundaries

- Transport parses requests and maps safe responses.
- Schemas validate structure and formats.
- Services coordinate use cases and transactions.
- Domain rules decide states, normalization, confidence, and approval eligibility.
- Repositories own database queries and always receive workspace scope explicitly.
- Object storage owns binary source content; the database stores metadata and references.
- Extraction adapters read source content and return canonical proposals; they do not approve records.
- The application depends on repository and transaction interfaces, not directly
  on Drizzle or PostgreSQL types.
- Database-specific schema, migrations, indexes, and query optimizations remain
  inside the persistence adapter.

## Core principles

- Staging is separate from approved financial or analytical state.
- Original source and extracted proposal are immutable evidence; corrections are append-only revisions.
- Multi-record mutations and audit events are atomic.
- A content hash is not the only identity for a receipt; the same receipt may be re-uploaded with a different scan.
- No OCR or model output is trusted without validation and explicit workflow state.
- Switching OCR engines, database engines, or object-storage providers must be
  an infrastructure change with adapter/migration work, not a business-rule rewrite.
- Do not split services until scale, isolation, or provider boundaries require it.
