# Development Process

## Phase 0 — Definition gate

Confirm the linked-chat product intent, users, receipt formats, privacy model,
ledger integration expectations, language, and extraction-provider policy.
Resolve every `PROVISIONAL` item that affects the first slice. No application
implementation starts before the user says `go`.

## Slice process

Each slice must have one user outcome, explicit in-scope and out-of-scope
behavior, acceptance conditions, invalid cases, data/security impact, and a
verification plan. Implement only the approved slice end to end: interaction,
contract, authorization, domain behavior, persistence, audit/observability, and
presentation.

Use one Git branch per roadmap step, not per slice. Start the step branch from
the repository's default branch, then implement every approved slice for that
step on the same branch. After a step is reviewed and merged, start the next
step's branch from the updated default branch. Branch creation does not replace
the per-slice approval gate.

Before editing: read the current requirements, roadmap, progress, relevant
skills, and repository conventions. After editing: run proportionate tests,
type checks, lint/format/build, inspect the diff, and record evidence.

Advance only after acceptance is reviewed. New ideas become a decision or
follow-up slice rather than silent scope expansion.

## Current slice plan

The roadmap contains 25 vertical slices across Steps 1–6. Their outcomes,
boundaries, dependencies, risks, and acceptance conditions are defined in
[slice-plan.md](slice-plan.md). Promote only one slice at a time, add its exact
implementation plan and invalid cases, and identify its migration, security,
extraction, export, and integration risks before it starts. Slices 1.1 and 1.2
are approved and implemented. No later slice is approved.

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
