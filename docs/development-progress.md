# Development Progress

## Current state — Step 4 delivered; Step 3 acceptance limits remain

Slices 4.1–4.4 were implemented and pushed on `step-4-review-approval` after
explicit user authorization. They provide source-aligned review, versioned
correction, warning gates, and audited approval/rejection for receipts and
manual expenses. Step 5 is not authorized. The Step 3 OCR and worker acceptance
limits below remain open; the synthetic checks do not measure private-corpus
accuracy or real resource-failure behavior.

### Step 4 final check

- `pnpm check` passed: Prettier, ESLint, TypeScript, 52 TypeScript tests, 13 Python OCR tests, and Next.js production build.
- `docker compose config --quiet` passed; PostgreSQL and web were healthy, and the worker was running. A repeated `docker compose exec -T web pnpm db:migrate` passed without new migrations.
- Synthetic service checks passed in Compose: `pnpm smoke:auth`, `pnpm smoke:intake`, `pnpm smoke:extraction`, and `pnpm smoke:review`. With the worker stopped, `pnpm smoke:queue-state` passed; the worker was then restarted. The review smoke covers receipt and manual origin, invalid cases, authorization, retries, rejection, automatic approval, and approved revision updates.
- Production browser checks across the slices covered image/PDF evidence highlights, mobile stacking, correction history, financial warning display, blocked auto selection, correction-triggered approval, and approved inbox status. These checks used invented source data only. No merge to `main` or later-step work was done.

## Step 4 — Slice 4.4 verification

- Added owner/editor manual approval and permanent rejection, owner-only per-record auto approval, and an approved-purchase snapshot linked to one receipt or manual origin. The same financial validation runs for manual and automatic approval. A blocked auto-selected record stays correctable and approves in the correction transaction once valid. Approved corrections update the snapshot with a revision and audit; invalid approved corrections fail without partial state.
- Migration `0010_review_approval.sql` applied and repeated without changes. `pnpm smoke:review` passed for approval/rejection authorization, permanent rejection, idempotent approval, financial blockers, blocked auto selection, automatic approval after correction, purchase uniqueness, approved correction snapshot, inbox status, workspace scope, and immutable lifecycle audit events. `pnpm check` passed with 52 TypeScript tests, 13 Python tests, and production build. A production browser pass showed approval disabled for a synthetic arithmetic mismatch, owner auto selection while blocked, automatic approval after correction, the purchase ID, and approved inbox status. The normal Compose web service was restored afterward.

## Step 4 — Slice 4.3 verification

- Added deterministic server-side warning evaluation for mandatory merchant, total, and category; OCR confidence/conflicts; tax unknown or contradictory status; exact integer arithmetic; missing export fields; and unavailable line items. Warnings expose financial/informational severity and separate approval/export blockers. The review screen displays them and reasoned confirmation of a mandatory OCR value creates an immutable revision and audit event.
- Migration `0009_review_confirmation.sql` applied and repeated without changes. `pnpm smoke:review` passed with blocked/ready states, informational export blockers, reasoned confirmation, receipt/manual corrections, authorization, retry, and audit assertions. Unit tests exercise mismatched arithmetic, tax unknown, missing mandatory fields, and conflicting/low-confidence OCR. `pnpm check` passed with 52 TypeScript tests, 13 Python tests, and production build. A production browser pass showed the informative export warning, then a synthetic discount correction produced the expected financial approval blocker.

## Step 4 — Slice 4.2 verification

- Added normalized receipt/manual review state and editor UI. The first read stays read-only at version 0; corrections preserve immutable proposal/manual originals, reject stale versions and changed base proposals, append before/after revisions with reason and actor, and write a separate content-free audit event atomically. Idempotency keys make retries safe.
- Migration `0008_review_revisions.sql` was applied to the local synthetic database and a repeated `pnpm db:migrate` passed. The first Compose web start timed out connecting to PostgreSQL after the temporary production UI check; recreating the web service restored connectivity. The SQL itself passed a transaction-wrapped local PostgreSQL check. `pnpm smoke:review` passed for owner/editor/viewer rules, invalid money, missing/reused keys, stale version and proposal rejection, receipt and manual corrections, retained original values, audit count, and revision immutability. `pnpm check` passed with 49 TypeScript tests, 13 Python tests, and production build. A production browser pass saved a receipt category correction and displayed its before/after history.
- Approved-record corrections were exercised with Slice 4.4 once approved purchases existed.

## Step 4 — Slice 4.1 delivered

- Created `step-4-review-approval` from updated `origin/main` on 2026-10-30.
- The review screen presents extraction fields and the authorized source side by side, selects the relevant source and page from receipt-level field evidence, and marks normalized image or rendered PDF coordinates when present. Missing regions are explicit. PDF.js renders private PDF pages for overlays and page navigation. Existing image zoom, rotation, crop, source access, and mobile stacking remain available. Review is read-only.
- `pnpm check` passed: formatting, lint, TypeScript, 46 TypeScript tests, 13 Python tests, and production build. The Compose production server rendered synthetic extracted PNG and two-page PDF sources beside field values; selecting the total displayed its source region on the correct image or PDF page. At 390px width, the layout stacked into one column without horizontal overflow. The local development server's HMR WebSocket did not connect through the browser tool, so the rendered check used `next start` and the normal development service was restored afterward.

## Step 3 delivery record — acceptance checks remain

Slices 3.1–3.4 were implemented on `step-3-local-extraction`. The completed
checks below establish the local synthetic path, but do not close every Step 3
acceptance condition.

The repository is in active development. The current process supports either
an explicitly authorized full-step run or user approval after each slice; both
record checks and push slice commits to the step branch. See
[development-process.md](development-process.md).

- Added deterministic, provider-neutral proposal normalization for Spanish
  receipt fields and line items. Exact text, confidence, source page/region,
  normalized UYU/USD money and date, conflicts, and missing-field warnings are
  preserved. Long card-number-like text is redacted before evidence storage.
- Migration `0007_receipt_proposals.sql` adds immutable proposals. Successful
  extraction now commits evidence, proposal, job completion, receipt `review`
  status, and audit together. The scoped read API and source page show a
  read-only proposal. At the Step 3 boundary, approval, correction, and export
  were not yet present.
- `pnpm check` passed with 46 TypeScript tests, 13 Python OCR tests, and the
  production build. `docker compose config --quiet` and repeated migrations
  passed. Final Compose web and worker images built and services became healthy.
  Synthetic auth and intake smoke passed. Extraction smoke passed with both a
  blank image and a rendered supermarket receipt; the latter confirmed total
  24,300 minor units, UYU, two lines, and source provenance. The same smoke
  confirmed a removed source fails without storing partial evidence or a
  proposal. Queue-state smoke passed after the proposal change with the worker
  stopped. One final production-build attempt hit the known intermittent
  TypeScript configuration parse error; the immediate full `pnpm check` rerun
  passed with the web service still stopped.
- The local Tesseract CPU benchmark completed all five synthetic cases:
  52/76 text evidence lines, 29/29 receipt-level lines, 23/47 line-item lines,
  and 41/65 coordinate matches. Mean latency was 718.22 ms and peak sampled
  host RSS was 21,256 KiB. PaddleOCR real-model and GPU runs were unavailable;
  the adapter was checked with synthetic model output. These fixture figures
  do not establish production accuracy.

### Step 3 verification still outstanding

- Run the PaddleOCR adapter with installed local models on CPU and, when
  hardware is available, GPU; compare it with Tesseract on the same corpus.
- Evaluate an approved private receipt corpus outside version control before
  selecting a production OCR default. The five invented fixtures are a
  repeatable baseline, not a production accuracy measure.
- Exercise actual worker termination/restart during a running job, cancellation
  while OCR is in flight, and resource exhaustion against live services. The
  database queue-state smoke covers recovery, stale-result rejection, and
  resource-pause transitions with the worker stopped; it does not reproduce
  those operating conditions.
- Manually check the browser queue, read-only proposal, and opt-in notification
  flow across roles. Route and API smoke checks do not establish the rendered
  interaction or browser permission behavior.

## Step 3 — Slice 3.3 delivered

- Added migration `0006_extraction_queue.sql`, workspace-scoped queue APIs,
  role-aware status screen, owner queue controls, opt-in browser notification,
  and a separate Compose worker. A global advisory lock enforces one worker at
  a time; run tokens prevent stale/cancelled work from storing evidence.
- Queue actions and state transitions are transactional with append-only audit.
  Five attempts use 1/2/4/8-minute delays. Restart recovery consumes the prior
  attempt; resource failure pauses the workspace and fails its running job.
- `pnpm check` passed with 41 TypeScript tests, 11 Python OCR tests, and the
  production build. Compose built the local Tesseract/Spanish worker image.
  Migration `0006` applied, and a repeated migration was a no-op. Synthetic
  API smoke passed for role enforcement, retries, idempotency, cancellation,
  OCR completion, evidence, and immutable audit. With the worker stopped,
  database smoke passed for backoff through attempt five, recovery, resource
  pause, stop, stale-result rejection, and manual retry. The web service was
  stopped for the production build and restarted afterward.

## Step 3 — Slice 3.2 delivered

- Added a versioned local OCR worker contract and replaceable TypeScript
  `ReceiptExtractionPort`. The adapter runs an isolated Python process against
  private temporary source files, validates output, enforces a timeout, and
  removes the files. The worker supports local image/PDF pages, PaddleOCR with
  explicitly installed local models, and a Tesseract Spanish TSV fallback.
- Successful output contains provider-neutral text regions, confidence,
  normalized boxes, page provenance, and duration. Failure codes contain no
  OCR text or source paths. No database, API, approval, or export state changed.
- `pnpm check` passed with 40 TypeScript tests, 11 Python OCR tests, and the
  production build. The Compose web service was stopped during the build to
  avoid known `.next` contention, then restarted. The local host lacks OCR
  engine packages/models, so adapter behavior was tested with synthetic/fake
  engine output; real OCR quality remains unmeasured.

## Step 3 — Slice 3.1 delivered

- Created `step-3-local-extraction` from updated `main` on 2026-10-29.
- Added five invented Spanish receipt cases across supermarket, restaurant,
  fuel, and utility sources. A local generator creates image/PDF files and
  expected field/line-item boxes outside version control; difficult cases
  cover blur, skew, glare, length, multiple pages, and missing tax.
- Added a versioned, local OCR-region benchmark command. It validates output,
  scores receipt-level and line-item text evidence and location overlap, and
  records per-case errors, latency, and sampled host RSS. Failed cases count as
  missed evidence. Reports contain no source text or OCR text.
- `pnpm check` passed with 37 TypeScript tests, 7 Python benchmark tests, and
  the production build. The CLI generated all five sources under `/tmp` and
  scored an empty synthetic engine response as 0/76 evidence lines with zero
  command failures. No real OCR candidate was available locally, so no engine
  accuracy or CPU/GPU comparison is claimed. This slice changes no database,
  API, production extraction, or approval behavior.

## Step 2 — Slice 2.4 delivered

- Added a workspace-scoped inbox combining staged receipts and manual expenses.
  The Spanish list and detail pages navigate to source or manual review. Source
  preview uses the private authorized download API and includes image zoom,
  rotation, visual crop, and PDF page controls.
- `pnpm check` passed with 37 unit tests and a production build. The synthetic
  intake smoke suite passed with inbox membership, status, scope, and page
  availability assertions. The full Step 2 check is recorded below.

## Step 2 — Complete development check

- `pnpm check` passed: formatting, lint, TypeScript, 37 unit tests, and the
  production build. The Compose web service was stopped during the production
  build because a concurrent Next.js dev process intermittently writes `.next`
  and causes a TypeScript configuration parse error; it was restarted after
  the build and returned to healthy state.
- `docker compose config --quiet` passed. The database and web service reached
  healthy state. A repeat `pnpm db:migrate` completed without reapplying
  migrations `0003`–`0005`.
- `pnpm smoke:auth` and `pnpm smoke:intake` passed in Compose with synthetic
  data. Together they cover authentication, workspace roles, source storage,
  exact and likely duplicates, retry conflicts, manual origin, inbox scope,
  append-only audits, and the Step 2 page routes.
- Step 2 supports staged records. Extraction, correction, approval, export,
  and their later lifecycle statuses remain assigned to Steps 3–6. Browser PDF
  preview depends on the browser's PDF viewer; download remains available.

## Step 2 — Slice 2.3 delivered

- Added source-free manual expense and line-item tables, an explicit manual
  origin in the API, audited and retry-safe creation, scoped read, and a Spanish
  creation screen. Approval and export remain assigned to Steps 4–6.
- Migration `0005_manual_expenses.sql` applied locally. `pnpm check` passed
  with 37 unit tests and production build. `pnpm smoke:intake` passed with
  synthetic creation, retry, invalid amount, cross-workspace, provenance, and
  audit assertions.

## Step 2 — Slice 2.2 delivered

- Added optional, user-entered intake facts for deterministic likely-duplicate
  matching. A review screen and workspace-scoped APIs list suggestions and
  record an explicit `same` or `different` decision.
- Decisions are retry-safe, conflicting decisions fail, and both receipt/source
  histories remain. The decision and its append-only audit event commit together.
- Migration `0004_likely_duplicates.sql` applied locally. `pnpm check` passed
  with 37 unit tests and a production build; `pnpm smoke:intake` passed with
  synthetic similar receipts and a decision retry. Final source-retention
  assertions are included in the smoke script.

## Step 2 — Slice 2.1 delivered

- Created branch `step-2-receipt-intake` from `main` on 2026-10-29.
- Added staged receipt/source grouping tables, an atomic intake audit event,
  content-hash-based exact duplicate handling, and scoped create/read APIs.
- Formatting, lint, TypeScript, and 37 tests pass. The production build passed
  after a transient Next.js TypeScript configuration parse failure on its first
  rerun. Migration `0003_receipt_intake.sql` applied to the local Compose
  database, and a retry completed without reapplying it.
- Added a Spanish upload/camera intake screen. Exact source content now reuses
  the original live source within a workspace. `pnpm smoke:intake` passed against
  Compose, checking source/receipt duplicates, retries, ordered grouping,
  validation, workspace scope, and immutable intake audit. The existing
  `pnpm smoke:auth` suite passed after the source change.
- `pnpm check` passed with 37 unit tests and production build. The intake
  migration was retry-safe. The Version 1 system acceptance check remains a
  Step 6.5 task.

## Step 1 — Slices 1.1–1.4 delivery record

- Step 1 development used branch `step-1-secure-foundation`, created from
  `main`.
- Slice 1.1 was approved by the user's explicit `go` instruction and implemented
  on 2026-10-28.
- Slice 1.2 was approved by the user's request to start the next slice and
  implemented on 2026-10-28.
- Slice 1.3 was approved by the user's request to start the next slice and
  implemented on 2026-10-28.
- Slice 1.4 was approved by the user's explicit `go` instruction and implemented
  on 2026-10-28.
- Added an environment-configured, one-time local owner bootstrap on 2026-10-29;
  existing accounts are not reset or promoted.
- The repository now has a TypeScript/Next.js shell, validated local
  configuration, PostgreSQL Compose service, dependency health endpoint,
  account authentication, workspace membership/access requests, centralized
  role permissions, typed audit events, private source storage, workspace-scoped
  source access, optional environment-configured local owner bootstrap, quality
  commands, and synthetic fixtures.
- Slice 1.2 added the first migration for identity/workspace state. At the
  Step 1 boundary, receipt tables, upload, and extraction had not started.

## Definition record

- Confirmed the Version 1 product flow, screens, roles, receipt types, local
  extraction boundary, review rules, categories/products, export behavior, and
  ProyectoFinanzas integration direction.
- The complete decision record is in [decisions.md](decisions.md).
- Added 25 vertical slices to the roadmap. The Step 1 approval state at the
  time is superseded by the current state at the top of this file.
- Added detailed outcomes, boundaries, dependencies, risks, and acceptance
  criteria for all 25 slices in [slice-plan.md](slice-plan.md).
- Added the local OCR evaluation plan. The current runtime and unresolved
  provider choice are documented in [ocr-evaluation.md](ocr-evaluation.md).

## Remaining definition work (updated after Step 3)

- Inspect ProyectoFinanzas' current import model before finalizing integration
  schemas.
- Add an approved private receipt corpus and compare local OCR candidates
  before finalizing the engine choice; the synthetic benchmark is implemented.
- Finalize slice-specific API contracts and acceptance details when each slice
  is promoted for approval.
- Resolve deferred technical choices only when the affected development slice
  is approved.

## Step 0 — Definition review

- Reviewed the product decisions and core specifications against the roadmap
  and first-slice plan.
- Aligned Version 1 priorities and search scope with the confirmed decisions:
  line items are included when available; basic search is merchant, product,
  and receipt ID; manual expenses use the same review/approval flow.
- Added the manual-expense origin and revision boundary to the conceptual data
  model so manual entries do not imply receipt or OCR provenance.
- Confirmed the unresolved OCR engine choice does not affect Slice 1.1.
- Checks at the time: all 20 documentation Markdown files had resolvable
  relative links; no package manifest or project check command existed yet.

## Step 1 — Slice 1.1 verification

- `pnpm check` passes: formatting, ESLint, TypeScript, 6 unit tests, and the
  Next.js production build.
- `docker compose config --quiet` passes. A clean image build succeeds with
  generated and sensitive local files excluded by `.dockerignore`.
- Compose PostgreSQL and web services both reached `healthy`.
- Health endpoint returned `200 {"status":"ready"}` with PostgreSQL running,
  `503 {"status":"unavailable"}` while it was stopped, then returned ready
  after PostgreSQL restarted.
- Missing required configuration exits before `next dev` starts and prints
  only the variable name and safe validation message.
- `.env` was created from `.env.example` with synthetic local development
  values; `.env` is excluded from Git and Docker build contexts.

## Step 1 — Slice 1.2 verification

- `pnpm check` passes: formatting, ESLint, TypeScript, 15 unit tests, and the
  Next.js production build.
- PostgreSQL migration `0001_auth_workspaces.sql` applied successfully and a
  second `pnpm db:migrate` run exited successfully without reapplying it.
- `pnpm smoke:auth` passes against the Compose runtime with synthetic accounts.
  It covers UI route availability, registration/login, duplicate-account
  privacy, session cookies and revocation, workspace creation/idempotent retry,
  membership roles, access request retries and decisions, owner-only access,
  cross-workspace rejection, same-origin enforcement, multi-workspace
  selection, and append-only audit enforcement.
- No real email, password, session token, receipt, or financial data is used by
  the smoke check; its accounts remain in the local PostgreSQL volume.

## Step 1 — Slice 1.3 verification

- `pnpm check` passes: formatting, ESLint, TypeScript, 26 unit tests, and the
  Next.js production build.
- The permission matrix tests cover read, edit, and access management for owner,
  editor, viewer, and absent membership, including stable 403/404 errors.
- `docker compose config --quiet` and the retry-safe `pnpm db:migrate` pass.
- `pnpm smoke:auth` passes with synthetic accounts, including owner/editor/
  viewer enforcement, cross-workspace denial, and rejection of both audit-event
  updates and deletes by PostgreSQL.
- No migration or receipt-data schema changes were needed; existing state
  mutation/audit transactions and database immutability trigger are reused.

## Step 1 — Slice 1.4 verification

- `pnpm check` passes: formatting, ESLint, TypeScript, 33 unit tests, and the
  Next.js production build.
- `docker compose config --quiet` passes; PostgreSQL and web services are
  healthy. Migration `0002_source_storage.sql` applied successfully and a
  second migration run exits successfully without reapplying it.
- `pnpm smoke:auth` passes inside Compose with synthetic accounts and bytes. It
  covers role enforcement for upload/download/removal, signature rejection,
  upload idempotency and conflicting retries, cross-workspace source IDs,
  non-member privacy,
  download bytes, removal retry, preserved metadata, exactly-once operation
  audit events, and database-enforced audit immutability.
- Local adapter tests confirm UUID-only object paths, `0700` directory and
  `0600` file permissions, and retry-safe physical removal. No real receipt or
  financial data is used.

## Local development owner bootstrap follow-up

- `.env.example` now includes synthetic owner credentials and an optional
  workspace name. Paired email/password settings are validated without echoing
  values; an existing account is never reset or promoted.
- Startup creates a new user, owner workspace, membership, and both audit events
  in one transaction. Production startup rejects configured bootstrap
  credentials.
- `pnpm check` passes with 37 tests. The Compose bootstrap ran successfully,
  a repeat made no changes, and the synthetic smoke suite authenticated with the
  configured credentials and verified the owner workspace.
