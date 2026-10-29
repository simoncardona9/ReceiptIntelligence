import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const base = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const origin = new URL(base).origin;
const json = async (
  path: string,
  method: string,
  cookie?: string,
  body?: unknown,
  key?: string,
) => {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
    cookie: response.headers.get("set-cookie")?.match(/ri_session=[^;]*/)?.[0],
  };
};
function expect(actual: number, expected: number, step: string) {
  if (actual !== expected)
    throw new Error(`${step}: expected ${expected}, got ${actual}`);
}

async function run() {
  const email = `synthetic-intake-${randomUUID()}@example.invalid`;
  expect(
    (
      await json("/api/auth/register", "POST", undefined, {
        email,
        password: "synthetic-passphrase-42",
      })
    ).status,
    200,
    "register",
  );
  const login = await json("/api/auth/login", "POST", undefined, {
    email,
    password: "synthetic-passphrase-42",
  });
  expect(login.status, 200, "login");
  const cookie = login.cookie!;
  const workspace = await json(
    "/api/workspaces",
    "POST",
    cookie,
    { name: "Synthetic Intake" },
    randomUUID(),
  );
  expect(workspace.status, 201, "workspace");
  const workspaceId = (workspace.data.workspace as { id: string }).id;
  const path = `/api/workspaces/${workspaceId}`;
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);
  async function upload(key: string, content = bytes) {
    const response = await fetch(new URL(`${path}/sources`, base), {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "image/png",
        "X-Source-Filename": "synthetic.png",
        "Idempotency-Key": key,
      },
      body: content,
    });
    return {
      status: response.status,
      data: (await response.json()) as { source?: { id: string } },
    };
  }
  const first = await upload(randomUUID());
  expect(first.status, 201, "source upload");
  const sourceId = first.data.source!.id;
  const duplicate = await upload(randomUUID());
  expect(duplicate.status, 201, "duplicate source upload");
  if (duplicate.data.source?.id !== sourceId)
    throw new Error("Exact duplicate created another source");
  const second = await upload(
    randomUUID(),
    new Uint8Array([...bytes.slice(0, 8), 43]),
  );
  expect(second.status, 201, "second source upload");
  const sourceIds = [sourceId, second.data.source!.id];
  const facts = {
    merchant: "Mercado Sintético",
    date: "2026-10-29",
    totalMinor: 12345,
    currency: "UYU",
  };
  const key = randomUUID();
  const staged = await json(
    `${path}/receipts`,
    "POST",
    cookie,
    { sourceIds, facts },
    key,
  );
  expect(staged.status, 201, "stage receipt");
  const receiptId = (staged.data.receipt as { id: string }).id;
  const retry = await json(
    `${path}/receipts`,
    "POST",
    cookie,
    { sourceIds },
    key,
  );
  expect(retry.status, 200, "stage retry");
  if ((retry.data.receipt as { id: string }).id !== receiptId)
    throw new Error("Stage retry created another receipt");
  const exactDuplicate = await json(
    `${path}/receipts`,
    "POST",
    cookie,
    { sourceIds },
    randomUUID(),
  );
  expect(exactDuplicate.status, 200, "exact receipt duplicate");
  const third = await upload(
    randomUUID(),
    new Uint8Array([...bytes.slice(0, 8), 44]),
  );
  expect(third.status, 201, "third source upload");
  const similar = await json(
    `${path}/receipts`,
    "POST",
    cookie,
    {
      sourceIds: [third.data.source!.id],
      facts: { ...facts, merchant: "Mercado Sintetico" },
    },
    randomUUID(),
  );
  expect(similar.status, 201, "similar receipt");
  const similarId = (similar.data.receipt as { id: string }).id;
  const duplicatesPath = `${path}/receipts/${receiptId}/duplicates`;
  const suggestions = await json(duplicatesPath, "GET", cookie);
  expect(suggestions.status, 200, "duplicate suggestions");
  if (
    !(suggestions.data.suggestions as { receiptId: string }[]).some(
      (item) => item.receiptId === similarId,
    )
  )
    throw new Error("Matching intake facts did not suggest a duplicate");
  const decisionPath = `${duplicatesPath}/${similarId}`;
  expect(
    (await json(decisionPath, "POST", cookie, { decision: "same" })).status,
    200,
    "merge decision",
  );
  expect(
    (await json(decisionPath, "POST", cookie, { decision: "same" })).status,
    200,
    "merge retry",
  );
  expect(
    (await json(decisionPath, "POST", cookie, { decision: "different" }))
      .status,
    409,
    "conflicting decision",
  );
  expect(
    (
      await json(
        `${path}/receipts`,
        "POST",
        cookie,
        { sourceIds: [sourceId] },
        key,
      )
    ).status,
    409,
    "conflicting key",
  );
  expect(
    (
      await json(
        `${path}/receipts`,
        "POST",
        cookie,
        { sourceIds: [sourceId, sourceId] },
        randomUUID(),
      )
    ).status,
    400,
    "repeated source",
  );
  expect(
    (
      await json(
        `${path}/receipts`,
        "POST",
        cookie,
        { sourceIds: [sourceId] },
        randomUUID(),
      )
    ).status,
    409,
    "source already grouped",
  );
  expect(
    (await json(`${path}/receipts/${receiptId}`, "GET")).status,
    401,
    "unauthenticated read",
  );
  const read = await json(`${path}/receipts/${receiptId}`, "GET", cookie);
  expect(read.status, 200, "read staged receipt");
  if (
    JSON.stringify((read.data.receipt as { sourceIds: string[] }).sourceIds) !==
    JSON.stringify(sourceIds)
  )
    throw new Error("Source order changed");
  expect(
    (
      await json(
        `/api/workspaces/${randomUUID()}/receipts/${receiptId}`,
        "GET",
        cookie,
      )
    ).status,
    404,
    "foreign workspace",
  );
  const manualPath = `${path}/manual-expenses`;
  const manualFields = {
    merchant: "Gasto Sintético",
    date: "2026-10-29",
    totalMinor: 1500,
    currency: "UYU",
    categoryName: "Pruebas",
    lines: [
      {
        description: "Artículo de prueba",
        quantityMilli: 1000,
        totalMinor: 1500,
      },
    ],
  };
  const manualKey = randomUUID();
  const manual = await json(
    manualPath,
    "POST",
    cookie,
    manualFields,
    manualKey,
  );
  expect(manual.status, 201, "manual expense create");
  const manualId = (manual.data.expense as { id: string }).id;
  const manualRetry = await json(
    manualPath,
    "POST",
    cookie,
    manualFields,
    manualKey,
  );
  expect(manualRetry.status, 200, "manual expense retry");
  if ((manualRetry.data.expense as { id: string }).id !== manualId)
    throw new Error("Manual expense retry duplicated the entry");
  expect(
    (
      await json(
        manualPath,
        "POST",
        cookie,
        { ...manualFields, totalMinor: 1600 },
        manualKey,
      )
    ).status,
    409,
    "manual key conflict",
  );
  expect(
    (
      await json(
        manualPath,
        "POST",
        cookie,
        { ...manualFields, totalMinor: -1 },
        randomUUID(),
      )
    ).status,
    400,
    "manual amount validation",
  );
  const manualRead = await json(`${manualPath}/${manualId}`, "GET", cookie);
  expect(manualRead.status, 200, "manual expense read");
  if (
    (manualRead.data.expense as { origin: string }).origin !== "manual" ||
    "sourceIds" in (manualRead.data.expense as object)
  )
    throw new Error("Manual expense implied source provenance");
  expect(
    (
      await json(
        `/api/workspaces/${randomUUID()}/manual-expenses/${manualId}`,
        "GET",
        cookie,
      )
    ).status,
    404,
    "foreign manual expense",
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const manualAudit = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM manual_expense_audit_events WHERE expense_id = $1",
      [manualId],
    );
    if (manualAudit.rows[0]?.count !== "1")
      throw new Error("Manual expense audit duplicated or missing");
    const retained = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM receipt_sources
       WHERE receipt_id = ANY($1::uuid[])`,
      [[receiptId, similarId]],
    );
    if (retained.rows[0]?.count !== "3")
      throw new Error("Duplicate decision lost source links");
    const decisionAudit = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM receipt_duplicate_audit_events WHERE receipt_id = LEAST($1::uuid,$2::uuid) AND candidate_id = GREATEST($1::uuid,$2::uuid)",
      [receiptId, similarId],
    );
    if (decisionAudit.rows[0]?.count !== "1")
      throw new Error("Duplicate decision audit was duplicated or omitted");
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM receipt_intake_audit_events WHERE receipt_id = $1",
      [receiptId],
    );
    if (count.rows[0]?.count !== "1")
      throw new Error("Intake audit was duplicated or omitted");
    const event = await pool.query<{ id: string }>(
      "SELECT id FROM receipt_intake_audit_events WHERE receipt_id = $1",
      [receiptId],
    );
    try {
      await pool.query(
        "DELETE FROM receipt_intake_audit_events WHERE id = $1",
        [event.rows[0].id],
      );
      throw new Error("Intake audit was mutable");
    } catch (error) {
      if ((error as { code?: string }).code !== "P0001") throw error;
    }
  } finally {
    await pool.end();
  }
  console.info("Synthetic receipt intake smoke passed");
}
run().catch((error: unknown) => {
  console.error(
    "Synthetic receipt intake smoke failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
