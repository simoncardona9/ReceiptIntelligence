# Agent Development Workflow

Read the documentation before implementation. Work only on the approved
vertical slice. Do not infer permission to build future roadmap features.
Keep all approved slices for one roadmap step on its single step branch;
approval is still required separately for each slice.

For sensitive mutations, define authoritative state, invariants, allowed
transitions, idempotency, audit behavior, and rollback semantics before code.
For layered changes, keep transport, schemas, services, rules, repositories,
and storage adapters separate. Use synthetic data and provide delivery evidence.

Never push or merge directly to `main`; review and merge remain a human action.
