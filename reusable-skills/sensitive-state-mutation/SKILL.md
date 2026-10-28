---
name: sensitive-state-mutation
description: Design operations affecting money, permissions, privacy, or other sensitive state.
---

Define authoritative state, invariants, allowed transitions, explicit inputs,
failure semantics, idempotency, and audit metadata before implementation.
Preserve original source values beside derived values. Make dependent records
and audit changes atomic; reject conflicts without partial state.
