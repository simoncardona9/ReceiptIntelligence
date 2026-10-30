# Data Model

## Core entities

The sections below include both persisted Step 1–3 entities and planned
Step 4–6 entities. The latter are identified where they appear.

### Workspace, user, membership, and session

The workspace is the tenant boundary. Membership assigns a role and every
receipt query is scoped by workspace. Users have unique normalized emails and
scrypt password hashes. Sessions store only SHA-256 hashes of random opaque
tokens, with expiry, revocation, and an optional active workspace selection.

### AccessRequest

An access request links a registered user to a workspace and moves from pending
to approved or declined only through an owner decision. Approval creates the
membership and audit event atomically. At most one pending request exists for
the same user and workspace.

### ReceiptSource

Stores immutable source metadata: workspace, object key, content hash, media
type, original filename, byte size, upload actor, timestamps, and retention
state. Binary content is stored through the private object-storage adapter and
is not stored in PostgreSQL or application logs. Removal keeps this metadata
and records the actor and time.

### Receipt

Groups one to 20 ordered, live sources within a workspace. Intake creates it
as `staged`; extraction can move it through `processing`, `failed`,
`extracted`, and `review`. Its source links preserve intake order and the
ordered content-hash fingerprint supports exact duplicate detection.

### ExtractionJob and ExtractionEvidence

An extraction job belongs to a receipt and records queue status, attempts,
priority, run token, timestamps, and a safe error code. The worker stores
provider-neutral page evidence only for a valid completed run. Workspace queue
controls and append-only job events record pause/retry/cancel/recovery actions.
Extraction never changes an approved purchase directly.

### ReceiptProposal, ReviewRecord, and ReviewRevision

The persisted immutable proposal belongs to a receipt and completed job. It
contains extracted fields, confidence, source-region evidence, conflicts, and
warnings. A workspace-scoped review record pins the proposal used for the
original normalized fields. Corrections change only the current review fields;
immutable revisions retain prior/new values, confirmations, actor, and reason.
Raw provider payloads are not stored.

### ManualExpense and review revisions

A receipt-free expense has an explicit manual origin, creator, workspace, and
staged state. Its fields and optional line items are persisted without a
receipt source, extraction job, OCR evidence, or implied extraction provenance.
The same review, correction, and approval rules apply without implying OCR
provenance. Revisions retain actor, reason, and prior/new values.

### ReceiptLineItem (proposal data; approved persistence planned)

Proposed line items currently live inside the immutable proposal JSON; manual
expense lines are stored separately. Approved line-item storage is planned.
Monetary values use integer minor units or a fixed-precision decimal type.

### ApprovedPurchase

The user-approved normalized record links to exactly one origin: either a
receipt with its proposal or a manual expense. It stores approved
normalized fields, approval mode, actor, time, and review version. It is the
reporting authority for ReceiptIntelligence.

### Merchant, Category, and NormalizationSuggestion (planned)

Workspace-scoped normalized entities and suggestions. Suggestions never change
approved data automatically.

### AuditEvent

Append-only records cover source, intake, duplicate, manual-expense,
extraction, correction, approval, auto-approval choice, and rejection actions
with actor, workspace, time, entity reference, and safe metadata. Export events
are planned for Step 6.

## Relationships

```text
Workspace ──< Membership >── User
Workspace ──< Receipt ──< ReceiptSource (ordered links)
Workspace ──< ReceiptSource (private source metadata)
Receipt ──< ExtractionJob ──1? ExtractionEvidence
ExtractionJob ──1? ReceiptProposal (immutable, on success)
Workspace ──< ManualExpense
Workspace ──< AuditEvent, ExtractionJobEvent

ReceiptProposal or ManualExpense ──1? ReviewRecord ──< ReviewRevision
ReviewRecord ──1? ApprovedPurchase
Planned: Workspace ──< Merchant, Category, NormalizationSuggestion
```

The approved model must remain separate from proposals so reprocessing or a
provider correction cannot silently rewrite user-approved history.
