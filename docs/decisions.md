# Product Decisions

This document records the decisions confirmed during the refinement questions.
It is the current source of truth when earlier provisional wording conflicts
with this document.

## Product and scope

- ReceiptIntelligence manages household expenses and extracts receipt line-item data.
- It does not compare prices between merchants in Version 1.
- ProyectoFinanzas remains a separate project. ReceiptIntelligence provides data to it.
- Version 1 supports Uruguay, Spanish receipts, UYU and USD.
- Initial receipt types are supermarkets, restaurants, fuel stations, and utility/service bills.
- A receipt source is either an image or a PDF. Camera capture creates an image
  source; image upload and PDF upload are supported. Manual expense creation is
  a separate source type, not a receipt format.
- Version 1 is intended for 2–5 users and fewer than 500 receipts per month.

## Version 1 user flow

```text
Upload receipt or create manual expense
        -> local extraction
        -> review and correction
        -> approval
        -> basic search/view
        -> JSON/CSV export or ProyectoFinanzas delivery
```

Mandatory screens are login/workspace selection, receipt inbox, receipt upload,
review/correction, manual expense creation, approved-record search, product and
category management, export center/history, ProyectoFinanzas connections, and
extraction queue/status.

Basic search covers merchant, product, and receipt ID. Advanced filters are
deferred.

## Review and approval

- Every receipt starts in review. The owner may choose per-record automatic approval.
- Automatic approval never bypasses mandatory validation or financial blockers.
- Merchant, total, and category are required for approval.
- Tax/IVA is extracted exactly as shown. Missing or unreadable tax may be marked unknown and does not block approval.
- Date, currency, and payment method may be missing for approval, but missing export-required values block export until completed.
- Line items are extracted when possible. If usable line items are unavailable, one unsplit expense may be approved with a warning.
- If all arithmetic inputs are present, subtotal/discount/tax/total must reconcile strictly. Incomplete inputs may proceed with a visible warning.
- Approved records may be corrected by owners/editors with immutable revision history.
- Rejected records are permanent; a new receipt or manual expense is required.
- Blocked records remain correctable in the same workflow.

## Expenses, categories, and products

- One receipt may be split into multiple category allocations by selecting line items.
- Allocation amounts are calculated automatically and may be edited only with a reason.
- Receipt tax remains authoritative at receipt level and is not distributed across category allocations.
- Line-level tax is stored only when explicitly shown.
- Categories are hierarchical and initially based on ProyectoFinanzas categories.
- Users may create categories; owners control deletion/merging.
- Category compatibility uses names and hierarchy. Unmatched categories receive suggestions requiring confirmation, and confirmed mappings are remembered.
- Product descriptions preserve exact and normalized values.
- High-confidence equivalent products may be linked; uncertain brand differences require user confirmation.
- The workspace product catalog is editable by owners/editors, but product identity is internal and does not affect exports in Version 1.

## Export and ProyectoFinanzas integration

- Required receipt export fields: receipt ID, merchant, date, total, currency, category, tax/IVA, subtotal, and payment method.
- Optional receipt fields: notes, status, original filename, confidence, and correction history.
- Required line-item fields: description, quantity, unit, unit price, discount, tax when explicitly available, and line total.
- Optional line-item fields: product code/barcode and brand.
- Exports contain a receipt-level structure and a line-item structure.
- JSON and CSV use English field names with Spanish documentation/UI labels.
- Both neutral and ProyectoFinanzas-specific schemas are versioned.
- Each export includes a manifest with export ID, schema version, creation date, record count, currency totals, and content hash.
- Original receipt files are not embedded in exports.
- The ProyectoFinanzas-specific export includes ReceiptIntelligence product ID, normalized product name, and original description when available.
- ReceiptIntelligence and ProyectoFinanzas maintain separate compatible category catalogs and mappings.
- Neutral export remains available for unmapped categories; ProyectoFinanzas export is blocked until required mappings are resolved.
- Financially dangerous warnings block export automatically. Informational warnings do not.
- Batch exports may contain valid records while listing blocked records separately. Records are marked exported independently.
- Users may select/deselect records before export.
- File delivery is a ZIP containing manifest, JSON, and CSV.
- Direct delivery uses one request per receipt to a ProyectoFinanzas endpoint. Each receipt has an independent result and manual retry.
- ProyectoFinanzas owns the receiving API contract and versioning. Duplicate prevention relies on the stable receipt ID checked by ProyectoFinanzas.
- Existing exports remain preserved. Re-exports may be full replacement or correction-only, chosen by the user.

## Roles and access

- Owner: full workspace, archive, source removal, queue control, connections, and automatic-approval permissions.
- Editor: upload, review, correct, approve, reject, create categories, retry/prioritize jobs, export, and direct delivery; cannot cancel jobs or control the queue.
- Viewer: read-only access to records, receipt files, line items, and queue status; no mutation or export permissions.
- Owners and editors may configure ProyectoFinanzas connections.
- Owners and editors may view audit history; audit events are immutable.
- Downloading a source file is audited; viewing it is not.

## Workspace and retention

- Users authenticate with email/password.
- Anyone may register and request workspace access; only the owner approves access.
- Users may belong to multiple workspaces with separate roles.
- Any authenticated user may create a workspace.
- Only owners may archive or restore a workspace. Archived workspaces are owner-only.
- Records are never physically deleted; they are archived. Owners may include archived records explicitly in reports, but archived records are never exported to ProyectoFinanzas.
- Owners may remove original files while retaining structured data and audit history; the record displays removal status/date/user.
- Database backups cover structured data only, not original receipt files.

## Local extraction and queue

- Processing remains local/private: OCR/rules plus optional locally hosted AI/document models.
- CPU is the baseline; optional GPU acceleration is supported.
- Conflicting extraction results are shown together for user choice/correction.
- Extraction runs in a persistent one-at-a-time queue.
- Jobs survive restarts, use up to five automatic attempts with increasing delays, and then require manual retry.
- Owners/editors may prioritize jobs; only owners may cancel jobs or pause/resume the queue.
- Viewers can see queue status. Only owners see detailed extraction errors.
- Queue pause stops running jobs; stopped jobs remain stopped until manually retried.
- Resource failures automatically pause the queue, fail affected jobs, and notify the owner. Resume is manual.
- Queue and cancellation/resource events are audited.
- Browser notifications require explicit permission; in-app status is always available.

## Deferred decisions

- Offline operation requirements.
- Exact local OCR and model selection.
- Detailed ProyectoFinanzas endpoint contract and dry-run endpoint.
- Password recovery.
- Advanced filters and reporting.

## Replaceable infrastructure decision

PaddleOCR is the initial OCR candidate, and PostgreSQL/Drizzle is the initial
database implementation. Both are replaceable:

- OCR engines implement a provider-neutral extraction port.
- Database access is isolated behind repository and transaction ports.
- Business rules, approval workflow, audit semantics, export schemas, and
  approved records must not depend on PaddleOCR, Tesseract, PostgreSQL, or
  Drizzle-specific types.
- Replacing either system requires adapter tests, migration/reconciliation
  evidence where data is affected, and an explicit architecture decision.

## Authentication implementation details

These implementation choices apply to Slice 1.2: email addresses are trimmed
and normalized to lowercase; passwords accept 12–128 characters and are stored
as scrypt hashes; sessions use random 256-bit tokens with only SHA-256 hashes
stored in the database, seven-day expiry, revocation, and HttpOnly/SameSite=Lax
cookies that are Secure in production. Mutating browser requests require a
same-origin `Origin` header. Password recovery and email verification remain
deferred because no recovery or mail provider is defined.
