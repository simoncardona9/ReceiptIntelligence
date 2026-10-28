# Local OCR Evaluation

## Recommendation

Use **PaddleOCR as the primary local OCR candidate**, starting with its text
recognition pipeline and evaluating PP-StructureV3 for document layout and
line-item/table structure. The official documentation describes local use,
CPU-capable deployment options, multilingual recognition including Spanish,
and structure parsing for document images/PDFs.

Keep **Tesseract** as a small, mature fallback and benchmark baseline. It has
official Spanish language data and a simple local deployment model, but it is
not the preferred primary engine for receipt layout and line-item detection.

Do not choose a local AI/document model as the first extraction dependency.
Evaluate it only after the OCR baseline produces a measured corpus of hard
receipts and known failure cases.

## Proposed boundary

```text
Next.js/TypeScript application
        |
        | local job protocol
        v
Python extraction worker
        |
        +-- PaddleOCR adapter
        +-- Tesseract adapter
        +-- optional later local document model
```

The Python worker is a narrowly scoped document-processing component, not a
second general backend. It returns provider-neutral text boxes, text,
confidence, page/source coordinates, and processing diagnostics. The
TypeScript application owns workflow, validation, approval, persistence, and
exports.

The worker communicates through a versioned internal extraction contract. A
future OCR engine can implement the same contract without changing the queue,
review UI, approval rules, database repositories, or export schemas.

## Evaluation gates

Before selecting a production default, test approved/synthetic Uruguayan image
and PDF receipts across supermarkets, restaurants, fuel, and utilities. Measure:

- Merchant, date, total, currency, subtotal, tax, and payment-method accuracy.
- Product description, quantity, unit, price, discount, and line-total accuracy.
- Source-region coordinates for review highlighting.
- CPU latency and memory use.
- GPU acceleration benefit when available.
- Failure behavior for blur, skew, glare, long receipts, multiple pages, and
  missing values.

The OCR engine must not be allowed to approve or export a receipt directly.
Its output is always a proposal subject to the application validation and
review rules.
