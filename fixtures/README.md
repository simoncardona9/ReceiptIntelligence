# Synthetic fixtures

Files in this directory contain invented values for automated checks and local
development. Do not add real receipts, source images, OCR text, account data,
or financial records.

`ocr/cases.json` defines invented receipt text for the local OCR benchmark.
Render its image/PDF sources outside the repository with
`python3 scripts/ocr_fixtures.py /tmp/receipt-ocr-fixtures`. See
`docs/ocr-evaluation.md` for the benchmark contract and privacy boundary.
