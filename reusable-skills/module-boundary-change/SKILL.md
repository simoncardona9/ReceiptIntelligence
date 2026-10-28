---
name: module-boundary-change
description: Implement layered capabilities with clear controller, validation, service, repository, and domain boundaries.
---

Transport parses and maps responses, schemas validate structure, services apply
use cases, domain rules decide behavior, and repositories own scoped queries.
Pass workspace scope explicitly. Use stable errors, transactions for multi-record
changes, and focused tests at the smallest useful layer.
