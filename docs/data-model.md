# Data Model

## Core entities

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

### ExtractionRun

Records the extraction adapter/version, status, started/completed times, safe
error code, and provider-neutral processing metadata. It never changes an
approved purchase directly.

### ReceiptProposal and ProposalRevision

The proposal contains extracted fields, confidence, field evidence/source
locations, warnings, and validation status. A revision records corrections,
actor, reason, and the prior/new safe values. Raw provider payloads are retained
only if the approved retention policy permits it.

### ManualExpense and ManualExpenseRevision

A receipt-free expense has an explicit manual origin, creator, workspace, and
review state. Its fields and optional line items use the same validation and
approval rules as receipt-derived proposals, but it has no receipt source,
extraction run, OCR evidence, or implied extraction provenance. Corrections
retain actor, reason, and prior/new safe values.

### ReceiptLineItem

Stores proposed or approved description, quantity, unit, unit price, tax, and
total with currency and evidence. Monetary values use integer minor units or a
fixed-precision decimal type.

### ApprovedPurchase

The user-approved normalized record links to exactly one origin: either a
receipt source with its proposal or a manual expense. It stores approved
merchant/date/amount/currency/category and approval metadata. It is the
reporting authority for ReceiptIntelligence.

### Merchant, Category, and NormalizationSuggestion

Workspace-scoped normalized entities and suggestions. Suggestions never change
approved data automatically.

### AuditEvent

Append-only record of upload, extraction, correction, approval, rejection,
export, link, retention, and deletion actions with actor, workspace, time,
action, entity reference, and safe metadata.

## Relationships

```text
Workspace ──< Membership >── User
Workspace ──< ReceiptSource ──< ExtractionRun
ReceiptSource ──< ReceiptProposal ──< ProposalRevision
ManualExpense ──< ManualExpenseRevision
ReceiptProposal ──< ReceiptLineItem
ReceiptProposal ─┐
                 ├──1 ApprovedPurchase ──< ReceiptLineItem
ManualExpense ───┘
Workspace ──< Merchant, Category, AuditEvent
```

The approved model must remain separate from proposals so reprocessing or a
provider correction cannot silently rewrite user-approved history.
