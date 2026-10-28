# Product Vision

## Working product statement

ReceiptIntelligence is a private application that turns Uruguayan receipt
images/PDFs or manual entries into structured, reviewable household expenses.
It extracts line items locally, preserves corrections and provenance, and
provides clean JSON/CSV or direct delivery to the separate ProyectoFinanzas
system.

## Problem

Receipts contain useful purchase information but are hard to search, compare,
categorize, and reconcile. Automated extraction can save time, but an incorrect
merchant, date, amount, tax, currency, or line item must never silently become
financial truth.

## Users

- An owner who configures the workspace and controls retention and sharing.
- Editors who upload, review, correct, and finalize receipts.
- Viewers who can search approved records but cannot mutate them.
- Version 1 roles are owner, editor, and viewer.

## Product outcome

A user can upload a receipt or create a manual expense, see local extraction,
correct uncertain fields, approve the record, search it, and export it safely to
JSON/CSV or ProyectoFinanzas. The approved record remains linked to its source
or manual origin and correction history.

## Boundaries

Version 1 is not an accounting authority, tax-filing system, payment system,
bank integration, merchant price-comparison system, or autonomous bookkeeping
agent. Local extraction proposes data; the user or owner-authorized workflow
approves it.

## Success criteria

1. A receipt never becomes an approved record without a visible review state.
2. Every approved amount and field is traceable to source evidence or a recorded correction.
3. Duplicate uploads are detected safely without losing the original provenance.
4. Users can find approved purchases by date, merchant, amount, category, and status.
