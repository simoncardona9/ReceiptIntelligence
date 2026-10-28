# Development Progress

## Current state — Slice 1.1 delivered

- Slice 1.1 was approved by the user's explicit `go` instruction and implemented
  on 2026-10-28.
- The repository now has a TypeScript/Next.js shell, validated local
  configuration, PostgreSQL Compose service, dependency health endpoint,
  quality commands, and synthetic fixtures.
- No business entities, migrations, receipt upload, authentication, extraction,
  production credentials, or real receipt data have been created.

## Definition record

- Confirmed the Version 1 product flow, screens, roles, receipt types, local
  extraction boundary, review rules, categories/products, export behavior, and
  ProyectoFinanzas integration direction.
- The complete decision record is in [decisions.md](decisions.md).
- Added 25 vertical slices to the roadmap; Slice 1.1 is approved and
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
