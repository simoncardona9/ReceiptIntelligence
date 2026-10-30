# Step 2 inbox and source review (Slice 2.4)

`GET /api/workspaces/{workspaceId}/inbox` returns up to 100 recent entries
from the active workspace. Every workspace member may read it. Each entry has
an ID, `origin` (`receipt` or `manual`), truthful `status`, creation time,
merchant hint when present, and source count. Receipt entries can now be
`staged`, `processing`, `failed`, `extracted`, or `review` through Step 3.
Manual expenses remain `staged`. Blocked, rejected, approved, and archived
states belong to later lifecycle slices. Missing membership returns `404` and
no foreign entries.

The Spanish inbox is at `/workspaces/{workspaceId}/inbox`. Receipt details
open a source review screen with source switching, image zoom/rotate/visual
crop, PDF page controls, and download. Browser PDF support may vary. It fetches
the existing private source endpoint, which authorizes and audits downloads.
Viewing and preview controls do not mutate receipt or source records. Removed
sources show an unavailable message. Manual expense details show their fields
and line items without implying source or OCR provenance.
