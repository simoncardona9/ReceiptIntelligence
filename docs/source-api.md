# Private source storage API

Source files are private binaries stored through the local `ObjectStoragePort`
adapter. The local default is `./.receipt-storage/private`; `SOURCE_STORAGE_DIRECTORY`
can set another private path. Compose uses a persistent `source-data` volume
mounted at `/var/lib/receipt-sources`. Files use generated UUID object keys,
directory permissions `0700`, and file permissions `0600`; the directory must
remain outside any public web root. PostgreSQL stores only source metadata and
audit events. API responses never expose storage keys.

Supported media are JPEG, PNG, WebP, and PDF. The server checks the file
signature against the declared `Content-Type`; files must be 1 byte to 10 MiB.
The filename is retained as sanitized metadata and is never used as a storage
path. Upload and remove operations require same-origin authenticated requests.
The API does not log filenames, source bytes, or receipt contents.

| Method and path                                           | Authentication | Request                                                                                  | Success                                                                                                                                   | Authorization and side effects                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/workspaces/{workspaceId}/sources`              | Session cookie | Raw binary body, `Content-Type`, `X-Source-Filename`, and UUID `Idempotency-Key` headers | `201 { "source": { id, workspaceId, contentHash, mediaType, originalFilename, byteSize, uploadedBy, uploadedAt, removedAt, removedBy } }` | Owner/editor only. Stores binary and metadata and appends `source_uploaded` audit event. Same key and content returns the original source; same key with different content returns `409 IDEMPOTENCY_KEY_REUSED`. |
| `GET /api/workspaces/{workspaceId}/sources/{sourceId}`    | Session cookie | None                                                                                     | Original bytes with validated `Content-Type` and attachment disposition                                                                   | Any workspace member. Appends `source_downloaded` after the read succeeds. Uses `private, no-store` and `nosniff`.                                                                                               |
| `DELETE /api/workspaces/{workspaceId}/sources/{sourceId}` | Session cookie | Empty body                                                                               | `200 { "removed": true }`                                                                                                                 | Owner/editor only. Marks metadata removed, records actor/time and appends `source_removed`; then deletes the private binary. Repeating removal is safe and does not append another audit event.                  |

Workspace and source IDs must be UUIDs. Missing or foreign-workspace sources
return `404 SOURCE_NOT_FOUND`; members lacking edit permission receive
`403 WORKSPACE_PERMISSION_REQUIRED`. Invalid body type, signature, filename, or
size returns a stable `400` or `413` error. Infrastructure errors return a
generic `500 INTERNAL_ERROR`. Source metadata and audit history remain after
binary removal. This API is the private file storage boundary. Receipt
grouping and preview are implemented in Step 2; extraction is implemented in
Step 3; approval remains Step 4 work.

Since Slice 2.1, an exact-content upload in the same workspace returns the
existing live source rather than creating another source or upload audit event.
This also applies when the new upload uses a different idempotency key.

Example upload uses synthetic bytes only:

```http
POST /api/workspaces/15ad15b8-4e88-40e2-896a-7b1bcf394dee/sources
Origin: http://localhost:3000
Cookie: ri_session=<opaque-session-token>
Content-Type: image/png
X-Source-Filename: synthetic.png
Idempotency-Key: 5cbca86f-8a93-4314-9c80-93cc6f997614

<synthetic PNG bytes>
```
