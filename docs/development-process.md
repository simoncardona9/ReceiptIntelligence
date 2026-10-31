# Development Process

## Phase 0 — Definition gate (completed)

Confirm the linked-chat product intent, users, receipt formats, privacy model,
ledger integration expectations, language, and extraction-provider policy.
Resolve every `PROVISIONAL` item that affects the first slice. The user gave
`go` for Step 1, and Steps 1–4 are now implemented. Later steps still require
their own authorization.

## Slice process

Each slice must have one user outcome, explicit in-scope and out-of-scope
behavior, acceptance conditions, invalid cases, data/security impact, and a
verification plan. Implement only an authorized slice end to end: interaction,
contract, authorization, domain behavior, persistence, audit/observability, and
presentation.

Use one Git branch per roadmap step, not per slice. Start the step branch from
the repository's default branch, then implement every approved slice for that
step on the same branch. After a step is reviewed and merged, start the next
step's branch from the updated default branch. Branch creation alone does not
authorize work. A user request to complete **all** slices in a named step
authorizes those slices; a request for review after each slice adds a mandatory
approval gate between slices. Neither mode authorizes the following step.

Before editing: read the current requirements, roadmap, progress, relevant
skills, and repository conventions. After **each** slice: run proportionate
tests, type checks, lint/format/build, and applicable runtime/integration
checks; inspect the diff; record evidence and remaining limits; commit that
slice and push to the step branch. Required acceptance checks must pass before
advancing. If they cannot run, record the blocker rather than claiming the
slice is verified.

After the last slice, run the complete quality and system checks for the step,
record results, and commit/push any corrections on the same branch. In the
review-gated mode, present each slice's outcome and checks and wait for the
user's approval before starting the next. New ideas become a decision or
follow-up slice rather than silent scope expansion.

## Current slice plan

The roadmap contains 25 vertical slices across Steps 1–6. Their outcomes,
boundaries, dependencies, risks, and acceptance conditions are defined in
[slice-plan.md](slice-plan.md). Promote only one slice at a time, add its exact
implementation plan and invalid cases, and identify its migration, security,
extraction, export, and integration risks before it starts. Slices 1.1–4.4 are
implemented; Slice 5.1 and later slices are not approved. Step 3 has outstanding
acceptance verification documented in [development-progress.md](development-progress.md).

## Definition of done

- Requirements and business rules are identified.
- Authorization, validation, and safe failure behavior are covered.
- Tests exist for every changed behavior unless a documented exception applies.
- Source provenance and audit behavior are preserved.
- Replaceable infrastructure ports remain intact; provider/database-specific
  behavior stays inside adapters.
- No sensitive data or secrets are committed.
- API and user-facing documentation are updated.
- Verification evidence is recorded in `development-progress.md`.
