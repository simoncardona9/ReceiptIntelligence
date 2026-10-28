# Roadmap

## Step 0 — Product and system definition

Confirm provisional decisions, acceptance language, threat model, data model,
provider boundary, and the first vertical slice.

## Step 1 — Secure foundation

1. **1.1 — Repository and local runtime:** TypeScript/Next.js application,
   Docker Compose, configuration boundaries, checks, and synthetic fixtures.
2. **1.2 — Authentication and workspaces:** email/password authentication,
   workspace creation/access requests, memberships, and owner/editor/viewer roles.
3. **1.3 — Audit and authorization foundation:** server-side workspace scope,
   immutable audit events, safe errors, and permission tests.
4. **1.4 — Source storage boundary:** private receipt-file metadata, local/private
   storage adapter, upload/download authorization, and source removal status.

## Step 2 — Receipt and manual-expense intake

1. **2.1 — Receipt intake:** camera/image/PDF upload, with each receipt source
   represented as image or PDF, plus multi-file grouping,
   validation, content hash, and exact-duplicate detection.
2. **2.2 — Likely-duplicate review:** merchant/date/amount duplicate suggestions,
   user merge decision, and preserved source history.
3. **2.3 — Manual expense:** create a receipt-free expense with the same review,
   approval, category, line-item, and export model.
4. **2.4 — Inbox and source review:** staged/rejected/failed/blocked states,
   source preview tools, and basic record navigation.

## Step 3 — Local extraction and canonical proposal

1. **3.1 — OCR evaluation fixture:** synthetic/approved receipt corpus and
   benchmark for Spanish UYU/USD receipts.
2. **3.2 — OCR adapter:** local PaddleOCR-based adapter with an isolated worker,
   CPU baseline, optional GPU acceleration, and Tesseract fallback evaluation.
3. **3.3 — Extraction queue:** persistent one-at-a-time jobs, restart recovery,
   five attempts with backoff, cancellation, prioritization, pause/resume, and
   resource-failure handling.
4. **3.4 — Canonical normalization:** merchant, dates, amounts, currency, tax,
   subtotal, payment method, line items, confidence, source evidence, and
   extraction conflicts.

## Step 4 — Review, correction, and approval

1. **4.1 — Review workspace:** side-by-side source and fields, zoom/rotate/crop,
   PDF pages, source-region highlighting, and confidence labels.
2. **4.2 — Corrections and revisions:** editable proposals, original/normalized
   values, reasons, immutable revision history, and correction authorization.
3. **4.3 — Validation and warnings:** mandatory fields, tax-unknown handling,
   arithmetic reconciliation, financial warning severity, and blocked state.
4. **4.4 — Approval lifecycle:** owner-selected per-record auto-approval,
   approve/reject behavior, permanent rejection, and approved purchase creation.

## Step 5 — Categories, products, and approved records

1. **5.1 — Category catalog:** ProyectoFinanzas-derived hierarchical defaults,
   user creation, suggestions, mappings, and owner-controlled merge/archive.
2. **5.2 — Product catalog:** exact/normalized descriptions, workspace products,
   high-confidence matching, and user confirmation for uncertain brand matches.
3. **5.3 — Line-item and category allocations:** select line items, calculated
   splits, reasoned manual allocation corrections, and receipt-level tax.
4. **5.4 — Approved records and search:** approved list/detail, search by
   merchant/product/receipt ID, and archived-record visibility rules.

## Step 6 — Exports and ProyectoFinanzas integration

1. **6.1 — Neutral canonical schema:** versioned JSON/CSV, receipt and line-item
   structures, manifest, currency-separated totals, and content hash.
2. **6.2 — Export center:** ZIP generation, preview, record selection, blocking
   warnings, partial batch export, export history, and superseded versions.
3. **6.3 — ProyectoFinanzas mapping:** inspect the existing import model, create
   the specific adapter, category mapping, and product external references.
4. **6.4 — Direct delivery:** named connections, API-key/OAuth2 configuration,
   one-request-per-receipt delivery, independent results, manual retry, and
   connection test/dry-run contract.
5. **6.5 — Version 1 acceptance:** end-to-end synthetic receipt scenarios,
   duplicate/revision/export checks, role review, and delivery evidence.

## Version 1 acceptance boundary

Version 1 is complete when a user can upload a Uruguayan supermarket,
restaurant, fuel, or utility receipt—or create a manual expense—process it
locally, review/correct fields and line items, approve it, search it by merchant,
product, or receipt ID, and export it in a manifest-backed ZIP or deliver it to
ProyectoFinanzas. Duplicate detection, revision history, role authorization,
financial warning blockers, and per-receipt delivery results must be included.
