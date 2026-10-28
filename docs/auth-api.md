# Authentication and workspace API

All mutations require a same-origin `Origin` header. Mutations with inputs accept
JSON; logout and workspace selection have empty bodies. Authenticated endpoints
use the `ri_session` cookie. It is `HttpOnly`,
`SameSite=Lax`, scoped to `/`, expires after seven days, and is marked `Secure`
in production. The database stores only a SHA-256 digest of its random token.
Responses containing user or workspace data set `Cache-Control: no-store`.

Validation errors contain field names and safe messages only. Login failures use
the same `401 INVALID_CREDENTIALS` response for unknown accounts and wrong
passwords. The API never returns password hashes or session tokens in JSON.

## Endpoints

| Method and path                                                           | Authentication          | Request                                                                           | Success                                              | Side effects and retry behavior                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register`                                                 | Public                  | `{ "email": "synthetic@example.invalid", "password": "synthetic-passphrase-42" }` | `200 { "status": "continue_to_sign_in" }`; no cookie | Creates an account and audit event when the normalized email is new. Existing emails receive the same status and body without a new account or session, preventing account enumeration. Sign in afterward. |
| `POST /api/auth/login`                                                    | Public                  | Email and password                                                                | `200` user; sets session cookie                      | Creates a hashed-token session and audit event. Invalid credentials return the same safe `401`.                                                                                                            |
| `GET /api/auth/session`                                                   | Session cookie          | None                                                                              | User, active workspace ID, memberships               | Read only; expired and revoked sessions return `401`.                                                                                                                                                      |
| `POST /api/auth/logout`                                                   | Session cookie optional | Empty body                                                                        | `200`; clears cookie                                 | Revokes the presented session and appends an audit event. Repeating logout is safe.                                                                                                                        |
| `GET /api/workspaces`                                                     | Session cookie          | None                                                                              | Active workspace ID and memberships                  | Read only and scoped to the signed-in user.                                                                                                                                                                |
| `POST /api/workspaces`                                                    | Session cookie          | `{ "name": "Synthetic Household" }`; UUID `Idempotency-Key` header                | `201` workspace                                      | Atomically creates the workspace, owner membership, session selection, idempotency record, and audit event. Same key/input returns the same workspace; same key/different input returns `409`.             |
| `POST /api/workspaces/{workspaceId}/select`                               | Session cookie          | None                                                                              | Selected membership                                  | Requires existing membership; updates only the caller's session and appends an audit event.                                                                                                                |
| `POST /api/workspaces/{workspaceId}/access-requests`                      | Session cookie          | Empty object                                                                      | Pending request                                      | A pending request is unique per user/workspace; retry returns the existing request. Existing members receive `409`.                                                                                        |
| `GET /api/workspaces/{workspaceId}/access-requests`                       | Owner membership        | None                                                                              | Pending requests with requester email                | Non-members receive `404`; non-owner members receive `403`.                                                                                                                                                |
| `POST /api/workspaces/{workspaceId}/access-requests/{requestId}/decision` | Owner membership        | `{ "decision": "approve", "role": "editor" }` or `{ "decision": "decline" }`      | Decision status                                      | Membership, request decision, and audit event commit atomically. Repeating the same decision is safe; conflicting decisions return `409`. Only editor/viewer roles may be granted.                         |

All workspace IDs and request IDs are UUIDs. A workspace or request belonging
to another workspace is returned as `404`. Internal database errors are mapped
to a generic `500` and are never returned to the client.

## Stable errors

| Status | Error codes                                                                                           | Meaning                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `INVALID_JSON`, `VALIDATION_FAILED`, `INVALID_IDENTIFIER`, `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_ROLE` | Input is malformed or invalid.                                                                                             |
| `401`  | `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`                                                      | A valid session is required or credentials are invalid. Login text is identical for an unknown email and a wrong password. |
| `403`  | `ORIGIN_REQUIRED`, `ORIGIN_NOT_ALLOWED`, `OWNER_REQUIRED`                                             | The mutation origin is untrusted or an owner-only operation was attempted by a member without the owner role.              |
| `404`  | `WORKSPACE_NOT_FOUND`, `ACCESS_REQUEST_NOT_FOUND`                                                     | The workspace/request is absent or outside the caller's membership scope.                                                  |
| `409`  | `ALREADY_A_MEMBER`, `ACCESS_REQUEST_DECIDED`, `REQUEST_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`            | The operation conflicts with existing membership, request, or idempotency state.                                           |
| `500`  | `INTERNAL_ERROR`                                                                                      | An unexpected failure occurred; database details are withheld.                                                             |

## Synthetic example

```http
POST /api/workspaces
Origin: http://localhost:3000
Cookie: ri_session=<opaque-session-token>
Idempotency-Key: 5cbca86f-8a93-4314-9c80-93cc6f997614
Content-Type: application/json

{"name":"Synthetic Household"}
```

```json
{
  "workspace": {
    "id": "15ad15b8-4e88-40e2-896a-7b1bcf394dee",
    "name": "Synthetic Household",
    "role": "owner"
  }
}
```

## Schema and lifecycle

The migration in `migrations/0001_auth_workspaces.sql` creates users,
workspaces, memberships, access requests, sessions, audit events, and
idempotency records. The Compose runtime applies pending migrations before
starting the web app. `pnpm db:migrate` safely reapplies the migration runner;
already-applied migrations are skipped.
