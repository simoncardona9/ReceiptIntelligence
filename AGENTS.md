# ReceiptIntelligence Agent Rules

This repository is in system-definition phase. Do not implement application
features, create migrations, or select a later roadmap slice until the user
explicitly says `go`.

Before development begins, read `docs/README.md`, the relevant specification
documents, and `docs/development-process.md`. Work one approved vertical slice
at a time. Keep source code, database schema, infrastructure, tests, and
documentation in their defined boundaries.

Financial and receipt-derived data is sensitive. Use synthetic data in tests,
preserve source provenance, avoid logging raw receipt contents, and make every
state-changing operation auditable and safely retryable.
