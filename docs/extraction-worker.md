# Local OCR worker contract (Slice 3.2)

`extraction/worker.py` accepts one version 1 JSON request on stdin and emits
one version 1 JSON result on stdout. The TypeScript `ReceiptExtractionPort`
accepts source bytes and hides this process protocol. Its local adapter writes
private temporary files with restrictive permissions, invokes the worker with
a timeout, validates the result, and removes the files. No receipt text is
written to application logs.

Request shape:

```json
{
  "version": 1,
  "engine": "tesseract",
  "device": "cpu",
  "sources": [{"id": "source UUID", "mediaType": "image/png", "path": "/private/path"}]
}
```

The worker checks that paths remain under `OCR_ALLOWED_ROOT`, limits each
source to 10 MB and the result to 20 pages, and accepts JPEG, PNG, WebP, and
PDF. It returns ordered pages with source ID, zero-based page index, pixel
dimensions, and text regions with a per-region confidence and normalized
`[left, top, right, bottom]` box. Diagnostics contain duration only. OCR output
is evidence, never an approved value.

Errors return `{ "version": 1, "error": { "code": "...", "retryable": false } }`.
Codes distinguish invalid input/source, unavailable engine, timeout, invalid
engine output, and retryable engine failure. Raw provider errors, source paths,
and OCR text are excluded from errors. The application may retain successful
provider-neutral evidence later, but it never stores a raw PaddleOCR payload.

Tesseract uses the local `tesseract` binary with Spanish language data and
groups TSV words into lines. PDF pages are rasterized locally with `pdftoppm`.
PaddleOCR uses its local `PaddleOCR.predict` API and requires both
`OCR_PADDLE_DETECTION_MODEL_DIR` and `OCR_PADDLE_RECOGNITION_MODEL_DIR` to point
to installed local models. CPU is the default; `device=gpu` is optional for
PaddleOCR. The host has no PaddleOCR models or Tesseract binary; the Compose
worker installs local Tesseract Spanish data. Paddle mapping and GPU selection
are checked with synthetic model output; real Paddle performance remains
unmeasured.

For a local benchmark after installing an engine, generate the synthetic
fixtures described in [ocr-evaluation.md](ocr-evaluation.md), then run:

```sh
OCR_ENGINE=tesseract python3 scripts/ocr_benchmark.py \
  /tmp/receipt-ocr-fixtures/manifest.json --name tesseract-cpu \
  --command 'python3 /absolute/path/to/extraction/benchmark_adapter.py' \
  --output /tmp/tesseract-cpu-report.json
```
