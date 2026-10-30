# ReceiptIntelligence Agent Rules

This repository is in active development. Steps 1–3 have been implemented;
Step 3 still has acceptance checks to complete. Do not start Step 4 or another
roadmap step without explicit user authorization. A request to complete every
slice in a named step authorizes those slices only; otherwise get approval for
each next slice.

Before development, read `docs/development-process.md`, the relevant
specifications, roadmap slice, and current progress. Work one vertical slice
at a time on a branch for the step. Run and record appropriate checks, then
commit and push each completed slice to that branch. After the final slice,
run the complete step check. Keep source code, database schema,
infrastructure, tests, and documentation in their defined boundaries.

When the user asks to review each slice, present its checks and commit and
wait for approval before continuing. Never push or merge to `main` as part of
either workflow. The reusable skills are `$develop-step` for an explicitly
authorized whole step and `$develop-slice-with-review` for approval after each
slice; `docs/development-process.md` remains the project-specific authority.

Financial and receipt-derived data is sensitive. Use synthetic data in tests,
preserve source provenance, avoid logging raw receipt contents, and make every
state-changing operation auditable and safely retryable.
