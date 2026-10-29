# Extraction queue API (Slice 3.3)

The queue is scoped to a workspace. Every endpoint requires an authenticated
session. Mutations require a same-origin `Origin` and UUID `Idempotency-Key`.
The same key and input replay without another state change or audit event;
reuse with different input returns `409`.

| Endpoint | Role | Result |
|---|---|---|
| `POST /api/workspaces/{workspaceId}/receipts/{receiptId}/extraction-jobs` | Owner/editor | Submit a staged/failed/extracted receipt. Returns `{job,created}` with `201`/`200`. |
| `GET /api/workspaces/{workspaceId}/extraction-jobs` | Any member | Returns `{queue:{paused,resourcePaused,role,jobs}}`; most recent 100 jobs. Detailed safe error codes appear only to owners. |
| `POST /api/workspaces/{workspaceId}/extraction-jobs/{jobId}/priority` | Owner/editor | JSON `{priority:0..10}` for queued/waiting jobs. |
| `POST /api/workspaces/{workspaceId}/extraction-jobs/{jobId}/retry` | Owner/editor | Manually restart a failed/stopped job and reset its five-attempt budget. |
| `POST /api/workspaces/{workspaceId}/extraction-jobs/{jobId}/cancel` | Owner | Cancel queued/running/waiting work. Running output is discarded. |
| `POST /api/workspaces/{workspaceId}/extraction-queue/pause` | Owner | Pause this workspace's queue and stop its running job. Stopped jobs require manual retry. |
| `POST /api/workspaces/{workspaceId}/extraction-queue/resume` | Owner | Resume this workspace, including after a resource pause. |

Missing or foreign receipt/job IDs return `404` after workspace authorization.
Viewers cannot mutate. Editors cannot cancel or control the queue. The web
screen at `/workspaces/{workspaceId}/extraction` polls status and offers
optional browser notifications only after explicit permission; in-app status
is always visible.

A separate Compose worker holds a PostgreSQL advisory lock, so only one worker
claims jobs at a time. Each claim and result is a transaction with an
append-only event. Running jobs recover to a retryable state after a worker
restart, using the already consumed attempt. Retryable failures wait 1, 2, 4,
then 8 minutes; the fifth failure is terminal until manual retry. Resource
failure pauses the workspace queue and fails the affected job. A run token
prevents a cancelled/stopped/stale process from storing evidence. Successful
jobs store only provider-neutral page evidence; no proposal is approved or
exported by this queue.

The Compose development worker has local Tesseract Spanish language data,
Python Pillow, and Poppler for PDF rasterization. PaddleOCR remains optional:
it needs a compatible Python environment and explicitly installed local model
directories. Set `OCR_ENGINE=paddle`, `OCR_DEVICE=cpu` or `gpu`, and local model
paths in the worker environment when that setup is available.
