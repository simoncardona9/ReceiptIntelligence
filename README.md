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
app and creates the optional bootstrap owner on first run. Configure
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

Run `pnpm db:migrate` to apply pending migrations manually. With the Compose
runtime running, `pnpm smoke:auth` exercises registration, sessions, workspace
creation and selection, access requests, owner decisions, and safe retries using
synthetic accounts. It leaves those synthetic accounts in the local database.

All bundled examples are synthetic. Do not place receipts, receipt-derived
values, credentials, or production configuration in this repository.

For the synthetic local OCR evaluation fixture and benchmark, see
[docs/ocr-evaluation.md](docs/ocr-evaluation.md). This is evaluation tooling;
it does not process staged receipts in the application.
