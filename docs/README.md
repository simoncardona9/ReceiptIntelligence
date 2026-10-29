# ReceiptIntelligence System Definition

This folder is the product and technical foundation for ReceiptIntelligence.
It must be reviewed before implementation starts.

| Document                                                   | Purpose                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [vision.md](vision.md)                                     | Problem, users, outcome, and boundaries                               |
| [requirements.md](requirements.md)                         | Functional and non-functional requirements                            |
| [functionalities.md](functionalities.md)                   | Release priorities and feature boundaries                             |
| [architecture.md](architecture.md)                         | System shape and dependency direction                                 |
| [technology-stack.md](technology-stack.md)                 | Technology decisions and deferred choices                             |
| [ocr-evaluation.md](ocr-evaluation.md)                     | Local OCR candidates, boundary, and benchmark plan                    |
| [extraction-worker.md](extraction-worker.md)               | Versioned local OCR worker protocol and adapters                       |
| [extraction-queue-api.md](extraction-queue-api.md)           | Persistent extraction queue API and lifecycle                          |
| [data-model.md](data-model.md)                             | Entities, ownership, and provenance                                   |
| [business-rules.md](business-rules.md)                     | Extraction, review, correction, and financial rules                   |
| [security-privacy.md](security-privacy.md)                 | Access, retention, privacy, and threat controls                       |
| [backend-api-design.md](backend-api-design.md)             | API and module boundaries                                             |
| [api-documentation-policy.md](api-documentation-policy.md) | Contract documentation requirements                                   |
| [auth-api.md](auth-api.md)                                 | Authentication and workspace API contracts                            |
| [source-api.md](source-api.md)                             | Private source-file storage API contract                              |
| [receipt-intake-api.md](receipt-intake-api.md)               | Staged receipt intake API and current limits                          |
| [duplicate-api.md](duplicate-api.md)                         | Likely duplicate suggestions and decisions                            |
| [manual-expense-api.md](manual-expense-api.md)               | Source-free manual expense intake                                     |
| [inbox-api.md](inbox-api.md)                                 | Step 2 inbox and read-only source review                              |
| [logging-error-policy.md](logging-error-policy.md)         | Safe logs and error semantics                                         |
| [development-process.md](development-process.md)           | Gated incremental delivery process                                    |
| [development-progress.md](development-progress.md)         | Factual progress and verification log                                 |
| [decisions.md](decisions.md)                               | Confirmed product decisions from refinement                           |
| [roadmap.md](roadmap.md)                                   | Ordered implementation steps and slices                               |
| [slice-plan.md](slice-plan.md)                             | Detailed vertical-slice outcomes, boundaries, and acceptance criteria |
| [agent-workflow.md](agent-workflow.md)                     | Rules for coding agents                                               |
| [git-workflow.md](git-workflow.md)                         | Branches, review, and merge rules                                     |

Product assumptions that could not be confirmed from the linked chat are marked
`PROVISIONAL`. They must be confirmed before the affected slice is approved.
