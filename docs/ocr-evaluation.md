# Local OCR Evaluation

## Recommendation

Evaluate **PaddleOCR as a primary local OCR candidate**, starting with its text
recognition pipeline and evaluating PP-StructureV3 for document layout and
line-item/table structure. The official documentation describes local use,
CPU-capable deployment options, multilingual recognition including Spanish,
and structure parsing for document images/PDFs.

Use **Tesseract** as the current Compose CPU runtime and benchmark baseline.
It has official Spanish language data and a simple local deployment model.
The project has not yet compared it with real PaddleOCR models on the same
corpus, so the production default remains undecided pending the gates below.

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

## Slice 3.1 synthetic benchmark

The committed corpus definition is `fixtures/ocr/cases.json`. Its invented
merchant, date, amount, and item text covers the four receipt types, UYU/USD,
blur, skew, glare, a long receipt, a two-page PDF, and a missing-tax case.
`scripts/ocr_fixtures.py` renders sources and `manifest.json` into a chosen
directory outside the repository. No generated receipt source is committed.
The generator requires Python 3, Pillow 12.1.1 (see
`requirements-ocr-fixtures.txt`), and the DejaVu Sans font at the path in the
script. The benchmark itself uses only the Python standard library and Linux
`/proc` for host resident-memory sampling.

```sh
python3 -m pip install -r requirements-ocr-fixtures.txt
python3 scripts/ocr_fixtures.py /tmp/receipt-ocr-fixtures
python3 scripts/ocr_benchmark.py /tmp/receipt-ocr-fixtures/manifest.json \
  --name candidate-cpu --device cpu \
  --command 'python3 /absolute/path/to/local-ocr-command.py' \
  --output /tmp/candidate-cpu-report.json
```

The local command receives one source path as its final argument and prints
one JSON object to stdout. Run the same manifest with another command and
`--name`/`--output` to compare candidates; use `--device gpu` for an optional
GPU run when suitable hardware and a local engine are available. The command
is given synthetic sources only. A GPU label records the chosen run mode; the
runner does not detect or measure GPU memory.

Compare reports from the same generated corpus with:

```sh
python3 scripts/ocr_compare.py /tmp/candidate-cpu-report.json /tmp/other-report.json
```

The comparison rejects reports with different corpus hashes and displays
failures, field/line evidence recall, coordinate recall, mean latency, and
sampled peak host RSS. Failed cases count as misses in recall denominators.

The version 1 output contract is:

```json
{
  "version": 1,
  "regions": [
    {
      "id": "region-1",
      "page": 0,
      "text": "MERCADO SOL DEL SUR",
      "confidence": 0.95,
      "box": [0.05, 0.04, 0.43, 0.09]
    }
  ]
}
```

Page indexes start at zero. `box` is `[left, top, right, bottom]`, normalized to
the page dimensions; `box` and `confidence` may be null when unavailable. The
runner rejects invalid pages, boxes, confidence, IDs, and output versions.
It scores each expected receipt-level and line-item text span against one OCR
region on the same page. Text matching ignores case, accents, and repeated
whitespace, and accepts similarity of at least 0.8. Coordinates count as
correct at intersection-over-union of at least 0.5. Reports contain per-case
and per-kind counts, misses, coordinate matches, latency, and sampled peak host
RSS. They contain no OCR text or source bytes. Command stderr is discarded;
failures and timeouts produce safe per-case errors. Set `--timeout` as needed.

These fixtures test OCR evidence only. Their synthetic typography and effects
cannot justify a production engine choice. Before selecting an engine, add an
approved private benchmark corpus outside version control, assess the same
metrics across CPU and available GPU runs, and inspect difficult failures
without recording receipt content in reports or logs. Canonical monetary/date
parsing and proposal quality are implemented in Slice 3.4; these OCR-only
fixture scores do not measure them.

## Recorded local baseline (2026-10-29)

The Compose worker's Tesseract Spanish CPU path ran all five synthetic cases
without command failures. It matched **52/76** expected evidence lines,
including **29/29** receipt-level lines and **23/47** line-item lines.
Coordinate overlap passed for **41/65** expected boxes. Mean per-case latency
was **718.22 ms** and sampled peak host RSS was **21,256 KiB**. The long glare
case matched **8/32** lines and accounts for all line-item misses. These
figures describe only the invented fixture corpus, on this local Compose
setup; they are not a production accuracy claim or a Paddle comparison.
