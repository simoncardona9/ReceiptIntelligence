# Requirements

## Functional requirements

### Workspace and access

- Users must authenticate before accessing receipt or purchase data.
- Data belongs to an isolated workspace/tenant.
- Roles must distinguish read-only access from upload, review, correction, and administration.
- Every query and mutation must be scoped to the active workspace on the server.

### Receipt intake

- Accept receipt images and PDFs. Camera capture is stored as an image source.
- Preserve the original source, content hash, filename, media type, size, and upload actor.
- Detect duplicate content and provide an idempotent upload result.
- Allow a receipt to remain staged, rejected, approved, or archived according to policy; source-file removal preserves the structured record and audit history.
- Support camera capture, image upload, PDF upload, and manual expenses without a receipt file.
- Support multiple images/files or multi-page PDFs as one logical receipt.

### Extraction and review

- Create an extraction proposal separately from the approved purchase record.
- Extract, when present: merchant, date, total, currency, taxes, subtotal, payment method, and line items.
- Store confidence and source location/evidence for extracted fields.
- Show missing, ambiguous, conflicting, and low-confidence fields for human review.
- Permit corrections while preserving the previous proposal and who changed it.
- Require explicit approval before downstream reporting uses the purchase.
- Allow owner-selected per-record automatic approval without bypassing validation or financial blockers.

### Search and reporting

- Provide basic search by merchant, product, or receipt ID. Advanced filters are deferred.
- Keep original and normalized values where normalization is applied.
- Report totals by currency; conversions require an explicit rate and date.
- Support export only for authorized users and record the export event.

### Integrations and automation

- Provide neutral and ProyectoFinanzas-specific JSON/CSV exports and direct one-receipt API delivery to configured ProyectoFinanzas connections.
- Receipt content remains local/private; no external OCR or AI provider receives it in Version 1.
- Extraction providers must be replaceable behind an application boundary.

## Non-functional requirements

- Responsive web interface for phone and desktop.
- Spanish-first UI with localization-ready messages.
- Decimal-safe monetary arithmetic; never use floating-point business logic.
- Encryption in transit and at rest where provided by the hosting platform.
- Safe, structured errors with no raw OCR payloads, secrets, or stack traces in client responses.
- Backups, retention, and deletion behavior must be documented before production use.
- Automated tests are mandatory for validation, authorization, extraction normalization, deduplication, and state transitions.
