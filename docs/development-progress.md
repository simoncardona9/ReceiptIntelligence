# Development Progress

## Current state — Slices 1.1–1.4 delivered

- Step 1 development is on branch `step-1-secure-foundation`, created from
  `main`; approved Step 1 slices will use this same branch.
- Slice 1.1 was approved by the user's explicit `go` instruction and implemented
  on 2026-10-28.
- Slice 1.2 was approved by the user's request to start the next slice and
  implemented on 2026-10-28.
- Slice 1.3 was approved by the user's request to start the next slice and
  implemented on 2026-10-28.
- Slice 1.4 was approved by the user's explicit `go` instruction and implemented
  on 2026-10-28.
- The repository now has a TypeScript/Next.js shell, validated local
  configuration, PostgreSQL Compose service, dependency health endpoint,
  account authentication, workspace membership/access requests, centralized
  role permissions, typed audit events, private source storage, workspace-scoped
  source access, quality commands, and synthetic fixtures.
- Slice 1.2 adds the first migration for identity/workspace state. No receipt
  tables, upload, extraction, production credentials, or real receipt data have
  been created.

## Definition record

- Confirmed the Version 1 product flow, screens, roles, receipt types, local
  extraction boundary, review rules, categories/products, export behavior, and
  ProyectoFinanzas integration direction.
- The complete decision record is in [decisions.md](decisions.md).
- Added 25 vertical slices to the roadmap; Slices 1.1–1.4 are approved and
  implemented, while later slices remain unapproved.
- Added detailed outcomes, boundaries, dependencies, risks, and acceptance
  criteria for all 25 slices in [slice-plan.md](slice-plan.md).
- Added the local OCR evaluation plan; PaddleOCR is the current candidate and
  Tesseract is the fallback/benchmark candidate.

## Remaining definition work

- Inspect ProyectoFinanzas' current import model before finalizing integration
  schemas.
- Build the approved/synthetic receipt benchmark before finalizing the OCR
  engine choice.
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
