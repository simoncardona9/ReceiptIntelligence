# Version 1 Vertical Slice Plan

This is the planning breakdown for Steps 1–6. These slices are ordered and
reviewable; approve each one individually and give it a focused implementation
plan before work starts. Slices 1.1–1.4 are implemented; no later slice is
approved.

## Step 1 — Secure foundation

### Slice 1.1 — Repository and local runtime

**Outcome:** A contributor can run the empty application and required local
services with documented commands.

**In scope:** TypeScript/Next.js shell, Docker Compose, environment validation,
format/lint/type/test commands, synthetic fixtures, and replaceable adapter
interfaces.

**Acceptance:** A clean checkout starts locally; health checks work; no secrets
or receipt data are required; checks fail clearly when required configuration is
missing. **Boundary:** no business entities or migrations beyond runtime health.

**Dependencies/risk:** none; establishes the runtime and adapter boundaries.

**Status:** Approved by the user with `go` and implemented on 2026-10-28.

**Draft implementation plan (Slice 1.1 only; not approved):**

1. Establish the TypeScript/Next.js App Router shell and pin the package
   manager/runtime versions in repository configuration.
2. Add a local Docker Compose runtime for the web app and PostgreSQL, with
   container health checks and no production credentials or receipt files.
3. Add validated environment configuration and a safe `.env.example`; fail
   clearly for missing or malformed required settings without printing values.
4. Add an application health endpoint and a minimal replaceable health-check
   port, without introducing business entities, persistence schema, or
   migrations.
5. Add only synthetic fixtures and document setup, startup, shutdown, and
   verification commands.
6. Add format, lint, type, test, and build commands and run the full check
   command plus a clean Compose startup/health/shutdown verification.

**Invalid cases to verify:** missing or malformed required configuration fails
with a safe variable-name-only message; an unavailable database produces an
unhealthy/degraded health result without leaking connection details; an
unhealthy Compose dependency is reported clearly; fixtures contain no real
receipt or financial data; and the slice creates no business tables, migration,
upload, authentication, or extraction behavior.

**Planned verification evidence:** package check command passes; environment
validation tests cover missing, malformed, and valid settings; health tests
cover ready and unavailable dependency cases; Compose starts the app and
database and reports health; repository scan confirms no secret values,
receipt samples, business schema, or migration artifacts were introduced.

### Slice 1.2 — Authentication and workspaces

**Outcome:** A user can register, create a workspace, request access, and sign
in to an approved workspace.

**In scope:** email/password authentication, sessions, workspace creation,
membership roles, owner approval, multiple-workspace selection, and basic login
UI.

**Acceptance:** unauthenticated users cannot access workspace data; only owners
approve access; roles are isolated per workspace; passwords and sessions are
stored safely. **Boundary:** no receipt data or file storage.

**Dependencies/risk:** 1.1; authentication and tenant-isolation risk.

**Status:** Approved by the user's request and implemented on 2026-10-28.

**Implementation plan:**

1. Add a single PostgreSQL migration for users, workspaces, memberships,
   access requests, hashed opaque sessions, and append-only auth/workspace
   audit events. Keep all IDs UUID-based and add uniqueness/state constraints.
2. Add validated email/password registration and login, scrypt password
   hashes, generic login failures, HttpOnly/SameSite session cookies, hashed
   session tokens, expiry/revocation, logout, and current-session lookup.
3. Add authenticated workspace create/list/select and access-request create/list
   and owner approve/decline operations. Commit membership/access state and its
   audit event atomically; reject cross-workspace IDs server-side.
4. Add Spanish-first register, sign-in, workspace selection, workspace create,
   and pending-access review screens using the same API contracts.
5. Add focused application/repository tests, migration checks, API contract
   documentation, and run `pnpm check` plus database-backed runtime checks.

**Invalid cases:** malformed email or workspace name; short or overlong
password; duplicate registration with an indistinguishable response; incorrect
credentials; missing, malformed, expired, or revoked session; request by an
existing member; duplicate pending request; non-owner approval/decline;
cross-workspace request IDs; invalid role; invalid Origin on browser mutations;
and database failure during workspace, membership, or audit writes. Failures
must not expose whether an account exists or leave partial state.

**Data/security boundary:** no receipt tables or file access. Never log
passwords, session tokens, or email addresses. Store only password hashes and
SHA-256 hashes of random session tokens. Audit records contain actor/entity
UUIDs and safe action/role metadata, not credentials or free-form user content.

### Slice 1.3 — Audit and authorization foundation

**Outcome:** Every protected operation has workspace and role enforcement and
important mutations create immutable audit events.

**In scope:** authorization helpers, workspace-scoped repository contract,
immutable audit event model, safe domain errors, and permission tests.

**Acceptance:** cross-workspace identifiers cannot read or mutate data; owner,
editor, and viewer rules are tested; audit events cannot be edited/deleted and
do not contain raw receipt content. **Boundary:** no receipt workflow.

**Dependencies/risk:** 1.2; foundational security risk.

**Status:** Approved by the user's request to start the next slice on
2026-10-28 and implemented on the Step 1 branch.

**Implementation plan:**

1. Define a shared role-to-permission policy for workspace reads, edits, and
   access management. Keep missing membership indistinguishable from a missing
   workspace and return a stable forbidden error for insufficient roles.
2. Apply the policy at the authoritative repository boundary for owner-only
   pending-request reads and access decisions. Keep workspace IDs explicit in
   scoped repository contracts and SQL predicates.
3. Define typed, immutable auth/workspace audit event actions and safe metadata;
   continue writing each event in the same transaction as its state mutation.
   Preserve the database trigger that rejects event updates and deletes.
4. Add unit tests for every role/permission combination and runtime checks for
   owner, editor, viewer, outsider, cross-workspace IDs, and audit immutability.
5. Document the permission matrix and error semantics, then run `pnpm check`,
   Compose configuration/migration checks, and the synthetic auth smoke suite.

**Invalid cases:** missing workspace membership; viewer/editor attempting
owner-only access management; an identifier from another workspace; invalid
role grants; audit metadata containing data outside the allowlisted safe
fields; failed state or audit writes; attempted audit update/delete. Rejected
mutations must leave no partial state or audit entry.

**Data/security boundary:** no receipt workflow, schema, or source data. Role
checks are based on persisted membership inside the authoritative adapter; a
request-provided role is never trusted. Audit metadata is limited to the
approved editor/viewer role value and contains no email, credentials, or
free-form content.

### Slice 1.4 — Source storage boundary

**Outcome:** The system can store and retrieve private source-file metadata and
authorized files without coupling business code to a storage vendor.

**In scope:** `ObjectStoragePort`, local/private adapter, source metadata,
authorized download, file removal status, content hash, and download audit.

**Acceptance:** unauthorized users cannot download files; downloads are audited;
removing a source preserves structured metadata and records who/when; business
code uses the port, not filesystem/SDK calls. **Boundary:** no extraction.

**Dependencies/risk:** 1.3; sensitive-file retention risk.

**Status:** Approved and implemented following the user's explicit `go`
instruction on 2026-10-28.

**Implementation plan (Slice 1.4 only):**

1. Add a provider-neutral `ObjectStoragePort` and private local adapter with
   opaque object keys, restrictive directory/file permissions, and no public
   filesystem paths.
2. Add source metadata persistence with workspace scope, SHA-256 content hash,
   validated media type, sanitized original filename, size, upload actor/time,
   and removal actor/time. Keep binary content out of PostgreSQL.
3. Add authenticated workspace-scoped upload, download, and removal APIs.
   Owners/editors may upload/remove; all members may download; other workspaces
   and non-members receive safe 404 responses. Require a UUID idempotency key
   for uploads and return the original source on a same-content retry.
4. Record upload, successful download, and removal audit events atomically with
   metadata changes where applicable. Keep audit records append-only and free
   of filenames, file bytes, and content text.
5. Validate file signatures and size before storage; make removal retries safe
   and preserve source metadata after binary removal.
6. Add service tests, synthetic database-backed smoke coverage, API and storage
   documentation, then run `pnpm check`, Compose/migration checks, and the auth
   plus source-storage smoke suite.

**Invalid cases:** unauthenticated or cross-origin mutations; missing workspace
membership; viewer upload/removal; cross-workspace source ID; invalid UUID;
unsupported or MIME/signature-mismatched files; empty or oversized content;
unsafe filename; removed or missing source download; failed metadata/audit
transaction; storage write/read/delete failure; repeated removal. Rejected
uploads leave no metadata or durable object, and retries do not duplicate
removal audit events.

**Data/security boundary:** no receipt entity, extraction, OCR, preview, or
approval state is introduced. Local binaries are private, keyed by generated
UUIDs, stored outside the public web root, and omitted from logs and responses.
The source API is an infrastructure boundary for later intake work.

## Step 2 — Receipt and manual-expense intake

### Slice 2.1 — Receipt intake

**Outcome:** A user can upload an image or PDF and see a staged receipt without
any financial record being approved.

**In scope:** camera/image/PDF input, multi-image/PDF grouping, validation,
content hash, source metadata, exact duplicate detection, and staged status.

**Acceptance:** invalid files are rejected safely; image/PDF sources are
preserved; exact duplicates are detected idempotently; no extraction or export
occurs before review. **Boundary:** likely duplicates and manual expenses are
separate slices.

**Dependencies/risk:** 1.4; file integrity and duplicate risk.

**Status:** Implemented on the Step 2 branch on 2026-10-29. Source uploads
deduplicate live exact content per workspace; an authenticated owner/editor can
stage an ordered group of up to 20 sources through the API or Spanish UI.
The source and receipt operations have independent idempotency keys, and the
receipt transaction writes its audit event atomically. Synthetic database
smoke tests cover duplicates, retries, validation, scope, order, and audit.

### Slice 2.2 — Likely-duplicate review

**Outcome:** A user can decide whether a likely duplicate is the same receipt.

**In scope:** duplicate suggestions using available merchant/date/amount data,
merge decision, source/history preservation, and audit event.

**Acceptance:** the system never merges automatically; confirmed merges retain
all source files and histories; rejected suggestions remain separate. **Boundary:**
requires proposal data but does not perform extraction itself.

**Dependencies/risk:** 2.1 and later 3.4 data; identity/reconciliation risk.

**Step 2 acceptance boundary approved on 2026-10-29:** Use optional
user-entered merchant/date/amount/currency intake hints. Match deterministically
within a workspace. An explicit owner/editor decision links or dismisses the
pair without deleting either record or source history. OCR-derived suggestions
are deferred to Slice 3.4. Invalid cases include missing/foreign receipt IDs,
non-matching pairs, self-pairs, viewer decisions, and conflicting retries.
Verify with `pnpm check`, migration retry, and synthetic intake smoke tests.

**Status:** Implemented on the Step 2 branch on 2026-10-29.

### Slice 2.3 — Manual expense

**Outcome:** A user can create an expense without a receipt file using the same
review, approval, and export model.

**In scope:** manual receipt-level fields, optional line items, origin metadata,
review status, validation, and source-free audit history.

**Acceptance:** manual expenses cannot pretend to have extraction provenance;
they follow approval rules; they can be searched and exported after approval.
**Boundary:** no OCR and no automatic external import.

**Dependencies/risk:** 1.3; financial-entry correctness.

**Step 2 acceptance boundary approved on 2026-10-29:** Create and read a
source-free staged manual expense with the fields and optional lines required
for later review. Preserve manual origin and a single creation audit event;
never imply receipt or extraction provenance. Approval, search, and export
operations belong to Steps 4–6. Invalid cases include missing/foreign IDs,
viewer creation, invalid money/date/currency/line values, and conflicting
idempotency retries. Verify with `pnpm check`, migration retry, and synthetic
database smoke checks.

**Status:** Implemented on the Step 2 branch on 2026-10-29.

### Slice 2.4 — Inbox and source review

**Outcome:** A user can find staged, processing, blocked, failed, rejected, and
approved records and open the relevant workflow.

**In scope:** inbox/list, lifecycle labels, source preview, zoom/rotate/crop,
PDF page navigation, and safe basic navigation.

**Acceptance:** statuses are truthful and role-aware; source preview does not
change data; archived/rejected visibility follows decisions. **Boundary:** no
field correction or approval logic beyond navigation.

**Dependencies/risk:** 2.1–2.3; lifecycle clarity.

**Step 2 acceptance boundary approved on 2026-10-29:** List the currently
reachable staged receipt and manual-expense records with truthful origin and
status, workspace scope, and role-aware navigation. Preview private image/PDF
sources through the authorized download endpoint with read-only controls.
Later processing, blocked, failed, rejected, approved, and archived states are
introduced by their owning lifecycle slices. Invalid cases include missing or
foreign workspace IDs, removed sources, absent sessions, and viewer mutation
attempts. Verify with `pnpm check`, synthetic inbox/source smoke checks, and
the complete Step 2 regression suite.

**Status:** Implemented on the Step 2 branch on 2026-10-29.

## Step 3 — Local extraction and canonical proposal

### Slice 3.1 — OCR evaluation fixture

**Outcome:** The project can compare local OCR candidates using a controlled
receipt corpus.

**In scope:** approved/synthetic Spanish receipt fixtures for supermarkets,
restaurants, fuel, and utilities; expected fields; benchmark runner; CPU and
optional GPU measurements; privacy-safe fixture policy.

**Acceptance:** benchmark measures receipt-level and line-item fields, source
coordinates, errors, latency, and memory; no real private receipts are
committed. **Boundary:** evaluation only; no production extraction workflow.

**Dependencies/risk:** 1.1; fixture quality determines engine choice.

### Slice 3.2 — OCR adapter

**Outcome:** A staged receipt can be processed locally into provider-neutral OCR
evidence.

**In scope:** Python worker, versioned extraction contract, PaddleOCR adapter,
Tesseract adapter boundary, CPU baseline, optional GPU path, and safe worker
errors.

**Acceptance:** the worker returns text, confidence, boxes/coordinates, pages,
and diagnostics without approval or persistence decisions; PaddleOCR can be
replaced behind the port; no network provider receives source content.
**Boundary:** no canonical financial normalization yet.

**Dependencies/risk:** 3.1 and 1.4; process isolation and resource use.

### Slice 3.3 — Extraction queue

**Outcome:** Users can submit and monitor extraction jobs that survive restarts.

**In scope:** persistent queue, one-at-a-time processing, five attempts with
backoff, retry, prioritization, owner-only cancel/pause/resume, resource pause,
notifications, and audited job events.

**Acceptance:** restart recovery is safe; failures are retryable; cancellation
discards partial output; resource failure pauses and fails affected jobs;
viewers see status while detailed errors remain owner-only. **Boundary:** worker
output is not yet approved or exported.

**Dependencies/risk:** 3.2; concurrency, cancellation, and recovery risk.

### Slice 3.4 — Canonical normalization

**Outcome:** OCR evidence becomes a provider-neutral proposal for receipt and
line-item fields.

**In scope:** exact/normalized values, merchant/date/amount/currency/tax/
subtotal/payment method, line items, confidence, source evidence, conflicts,
and missing-field warnings.

**Acceptance:** original text is preserved; money/date parsing is deterministic;
conflicting candidates remain visible; no provider-specific response is exposed
as approved data. **Boundary:** proposal remains unapproved.

**Dependencies/risk:** 3.2–3.3; Spanish receipt parsing and monetary safety.

## Step 4 — Review, correction, and approval

### Slice 4.1 — Review workspace

**Outcome:** A user can inspect the source and proposal together and understand
where extracted values came from.

**In scope:** side-by-side source/fields, confidence labels, source-region
highlighting for receipt-level fields, line-item display, and mobile fallback.

**Acceptance:** image/PDF pages are usable; source highlights are accurate when
available; unavailable evidence is explicit; viewing does not mutate data.
**Boundary:** correction submission is Slice 4.2.

**Dependencies/risk:** 2.4 and 3.4; usability and evidence trust.

### Slice 4.2 — Corrections and revisions

**Outcome:** Owners/editors can correct a proposal or approved record without
losing the original value.

**In scope:** editable fields, exact/normalized values, required reason where
defined, optimistic versioning, immutable revisions, and correction audit.

**Acceptance:** concurrent edits are rejected safely; old/new values and actor
are preserved; approved corrections create a new revision; no raw payloads are
logged. **Boundary:** validation/approval gates remain Slice 4.3–4.4.

**Dependencies/risk:** 1.3 and 3.4; financial history risk.

### Slice 4.3 — Validation and warnings

**Outcome:** Users can see exactly what blocks approval or export.

**In scope:** mandatory merchant/total/category, tax-unknown behavior, missing
export fields, strict reconciliation when inputs exist, incomplete-data
warnings, and financial versus informational severity.

**Acceptance:** financial blockers cannot be bypassed by auto-approval; tax may
be unknown; incomplete line items can produce an unsplit warning; warning
severity is deterministic and testable. **Boundary:** no approved-record write.

**Dependencies/risk:** 3.4; highest financial correctness risk.

### Slice 4.4 — Approval lifecycle

**Outcome:** A valid proposal becomes an approved purchase or a permanent
rejection through an audited, atomic action.

**In scope:** owner-selected auto-approval, owner/editor approval and rejection,
blocked state, permanent rejection, approved purchase creation, and atomic audit.

**Acceptance:** blocked records remain correctable; rejected records cannot be
reopened; auto-approval enforces all blockers; approval is idempotent and cannot
create duplicate approved purchases. **Boundary:** no export.

**Dependencies/risk:** 4.2–4.3; authoritative-state transition.

## Step 5 — Categories, products, and approved records

### Slice 5.1 — Category catalog

**Outcome:** Users can categorize approved expenses using a customizable
ProyectoFinanzas-derived hierarchy.

**In scope:** default import/adaptation, hierarchy, suggestions, user creation,
mapping memory, and owner-controlled merge/archive.

**Acceptance:** category suggestions never silently create data; mappings are
confirmed and remembered; deleting/merging preserves historical references.
**Boundary:** no direct ProyectoFinanzas export yet.

**Dependencies/risk:** 4.4; category compatibility risk.

### Slice 5.2 — Product catalog

**Outcome:** Users can maintain workspace product identities without changing
the source description used in exports.

**In scope:** exact/normalized descriptions, product name/brand identity,
high-confidence matching, uncertain-match confirmation, and owner/editor access.

**Acceptance:** original receipt descriptions remain unchanged; uncertain brand
matches require confirmation; catalog matching does not alter export data in
Version 1. **Boundary:** no price comparison.

**Dependencies/risk:** 3.4 and 4.2; identity ambiguity.

### Slice 5.3 — Line-item and category allocations

**Outcome:** A user can split one receipt into category allocations by selecting
line items.

**In scope:** calculated allocation amounts, manual correction with reason,
receipt-level authoritative tax, optional line-level tax, and reconciliation.

**Acceptance:** selected line items calculate the allocation; corrected amounts
require a reason; receipt totals and allocations reconcile when sufficient data
exists; tax is never silently distributed. **Boundary:** no export format.

**Dependencies/risk:** 4.4, 5.1, and 5.2; financial allocation risk.

### Slice 5.4 — Approved records and search

**Outcome:** Users can find approved records by merchant, product, or receipt ID.

**In scope:** approved list/detail, basic search, source access, line-item view,
archive/rejection visibility rules, and role-specific display.

**Acceptance:** search is workspace-scoped; archived records are hidden by
default; viewers see records/files but cannot mutate/export; results never
include another workspace. **Boundary:** advanced filters/reports deferred.

**Dependencies/risk:** 4.4–5.3; search/index correctness.

## Step 6 — Exports and ProyectoFinanzas integration

### Slice 6.1 — Neutral canonical schema

**Outcome:** An approved selection can be represented in stable versioned JSON
and CSV independent of ProyectoFinanzas.

**In scope:** receipt and line-item structures, English field names, manifest,
schema version, currency totals, content hash, product IDs, and export contract
tests.

**Acceptance:** required fields and optional fields are explicit; UYU/USD are
separate; original files are not embedded; schema is deterministic and
versioned. **Boundary:** file delivery and direct API are later slices.

**Dependencies/risk:** 4.4–5.4; contract stability.

### Slice 6.2 — Export center

**Outcome:** Owners/editors can preview, select, and download a safe ZIP export.

**In scope:** manifest/JSON/CSV ZIP, selection, preview, financial warning
blocking, partial batch export, export history, superseded versions, and
manual full/correction-only re-export choice.

**Acceptance:** blocked records are excluded and explained; valid records are
marked independently; archived records are never exported; export actions are
audited; repeated exports preserve history. **Boundary:** no direct endpoint.

**Dependencies/risk:** 6.1; data-leak and duplicate-export risk.

### Slice 6.3 — ProyectoFinanzas mapping

**Outcome:** The project can produce a ProyectoFinanzas-specific export matching
the receiving project’s import model.

**In scope:** inspection of ProyectoFinanzas import schema, adapter mapping,
category name/hierarchy suggestions, remembered mappings, product external
references, and unmapped-category blocking.

**Acceptance:** neutral export remains possible; ProyectoFinanzas export blocks
unresolved mappings; mapping decisions are auditable; schema compatibility is
tested with synthetic data. **Boundary:** no network delivery.

**Dependencies/risk:** 5.1 and 6.1; cross-project contract risk.

### Slice 6.4 — Direct delivery

**Outcome:** Owners/editors can send selected approved receipts to a configured
ProyectoFinanzas connection and see per-receipt results.

**In scope:** named connections, API key/OAuth2 credentials, secure config
references, one-request-per-receipt delivery, stable receipt ID, connection
test/dry-run, manual retry, safe errors, and delivery audit history.

**Acceptance:** accepted records and rejected records are tracked independently;
timeouts are failed and manually retryable; no automatic duplicate resend;
credentials never enter logs; receiving API versioning remains owned by
ProyectoFinanzas. **Boundary:** no automatic scheduling.

**Dependencies/risk:** 6.3; external-system and credential risk.

### Slice 6.5 — Version 1 acceptance

**Outcome:** The complete Version 1 flow is demonstrated with synthetic or
approved test receipts and documented evidence.

**In scope:** all four receipt types, manual expense, roles, duplicates,
corrections, blocked warnings, line allocations, ZIP exports, direct delivery,
retry behavior, and archive/source-removal behavior.

**Acceptance:** the Version 1 acceptance statement passes; relevant automated
checks pass; manual flows are recorded; no real receipt data/secrets are used;
remaining limitations are documented. **Boundary:** no new product features.

**Dependencies/risk:** all prior slices; release-readiness and reconciliation.

## Planning status

- Total planned slices: **25**.
- Approved slices: **4** (1.1–1.4).
- Implemented slices: **4** (1.1–1.4).
- Later slices remain drafts and are not authorized for implementation.
