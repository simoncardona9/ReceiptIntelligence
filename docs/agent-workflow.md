# Agent Development Workflow

Read the relevant documentation before implementation. Work one authorized
vertical slice at a time. Do not infer permission to build a later roadmap
step. Keep all authorized slices for one step on its single step branch. The
user can authorize all slices of a named step together or require approval
after each slice. Follow the selected mode in
[development-process.md](development-process.md).

For sensitive mutations, define authoritative state, invariants, allowed
transitions, idempotency, audit behavior, and rollback semantics before code.
For layered changes, keep transport, schemas, services, rules, repositories,
and storage adapters separate. Use synthetic data and provide delivery evidence.

Run appropriate checks and record evidence at the end of each slice. Commit
and push each verified slice to the step branch. After the last slice, run the
complete step check. Never push or merge directly to `main`; review and merge
remain a human action.
