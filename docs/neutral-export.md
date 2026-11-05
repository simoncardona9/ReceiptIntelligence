# Neutral export schema 1.0.0 (Slice 6.1)

`buildNeutralExport` accepts a selected set of approved purchase snapshots. It
produces UTF-8 `json`, `receiptsCsv`, `linesCsv`, and a manifest. The caller must
enforce workspace scope, edit permission, active status, and financial warning
checks before using this pure contract; delivery and history belong to Slice
6.2.

The JSON object has `schemaVersion` and ordered `records`. Each record includes
`receiptId` (stable approved purchase ID), `origin`, `originId`, `reviewVersion`,
`merchant`, `date`, `totalMinor`, `currency`, `category`, `subtotalMinor`,
`taxMinor`, `paymentMethod`, `discountMinor`, and `lineItems`. Each line has a
zero-based `lineIndex`, `description`, `quantity`, `unit`, `unitPriceMinor`,
`discountMinor`, `taxMinor`, `lineTotalMinor`, and optional `productId`,
`productName`, `brand`. Money is integer minor units. A null line value means
the approved record did not provide that detail; it is never inferred. Product
links refer to the matching approved review version. CSV has a header, CRLF
rows, quoted cells, doubled quotes, and empty cells for null.

Merchant, date, total, currency, category, subtotal, tax, and payment method
must be present to serialize. Manual expenses follow the same export contract.
UYU and USD totals remain separate. Records are sorted by purchase ID and lines
retain source order, so the payload is deterministic for a given snapshot.
The manifest contains export ID, creation time, schema version, record count,
both currency totals in minor units, and a SHA-256 digest of the concatenated
JSON, receipts CSV, and lines CSV bytes in that order. IDs and creation time
are supplied by the caller. Original source files and filenames are excluded.
