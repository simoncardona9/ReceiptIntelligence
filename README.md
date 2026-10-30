# ReceiptIntelligence

ReceiptIntelligence is a private, Spanish-first application for turning
Uruguayan receipt images/PDFs or manual entries into structured, reviewable
household expenses. Receipt extraction stays local; extracted values remain
proposals until the user-approved workflow accepts them.

## Local prerequisites

- Node.js 24 (see `.nvmrc`)
- pnpm 11.21.0 (Corepack can activate the pinned version)
- Docker Compose v2 or later

## Start the local runtime

```sh
cp .env.example .env
docker compose up --build
```

The web app is at <http://localhost:3000>. Its health endpoint is
<http://localhost:3000/api/health>. PostgreSQL is reachable only inside the
Compose network. The example credentials are local development values and must
not be reused elsewhere.

The Compose startup applies pending database migrations before starting the
app, starts the local extraction worker, and creates the optional bootstrap
owner on first run. Configure
`BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` in `.env` to choose the
login; `BOOTSTRAP_WORKSPACE_NAME` defaults to `Casa`. The example values are
synthetic local credentials only. Bootstrap is idempotent and never changes an
existing account's password or role. The account flow is also available at
`/register`, `/login`, and `/workspaces`.

To stop the services, run `docker compose down`. To also remove the local
database volume, run `docker compose down --volumes`.

## Run checks on the host

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting, lint, type checking, tests, and a production
build. `pnpm dev` and `pnpm start` validate required environment settings
before starting. Configuration errors name the invalid variable and never
print its value.

Run `docker compose exec -T web pnpm db:migrate` to apply pending migrations
manually. With Compose running, run the synthetic smoke checks inside `web`,
where both the app and database are reachable:

```sh
docker compose exec -T -e APP_BASE_URL=http://web:3000 web pnpm smoke:auth
docker compose exec -T -e APP_BASE_URL=http://web:3000 web pnpm smoke:intake
docker compose exec -T -e APP_BASE_URL=http://web:3000 web pnpm smoke:extraction
```

The auth check creates synthetic accounts in the local database. The intake
check covers source and receipt intake. The extraction check covers the local
OCR queue with synthetic images. The queue-state check requires an extraction
smoke record and the worker stopped:

```sh
docker compose stop worker
docker compose exec -T web pnpm smoke:queue-state
docker compose start worker
```

It checks retry/backoff, recovery, cancellation, resource pause, and
stale-result rejection against the local database. See
[docs/development-progress.md](docs/development-progress.md) for completed
checks and remaining Step 3 acceptance verification.

All bundled examples are synthetic. Do not place receipts, receipt-derived
values, credentials, or production configuration in this repository.

For the separate synthetic OCR evaluation fixture and benchmark, see
[docs/ocr-evaluation.md](docs/ocr-evaluation.md). The application uses the
local extraction queue described in
[docs/extraction-queue-api.md](docs/extraction-queue-api.md).
