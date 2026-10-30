import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadAppConfig } from "../src/server/config/app-config";
import type { ReviewRecord } from "../src/server/review/review-service";

const base = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const origin = new URL(base).origin;
async function api(
  path: string,
  method: string,
  cookie?: string,
  body?: object,
  key?: string,
) {
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
}
function expected(actual: number, wanted: number, name: string) {
  if (actual !== wanted)
    throw new Error(`${name}: ${actual}, expected ${wanted}`);
}
async function register() {
  const email = `synthetic-review-${randomUUID()}@example.invalid`;
  expected(
    (
      await api("/api/auth/register", "POST", undefined, {
        email,
        password: "synthetic-passphrase-42",
      })
    ).status,
    200,
    "register",
  );
  const login = await api("/api/auth/login", "POST", undefined, {
    email,
    password: "synthetic-passphrase-42",
  });
  expected(login.status, 200, "login");
  return login.cookie!;
}
async function run() {
  const owner = await register();
  const editor = await register();
  const viewer = await register();
  const workspace = await api(
    "/api/workspaces",
    "POST",
    owner,
    { name: "Synthetic Review" },
    randomUUID(),
  );
  expected(workspace.status, 201, "workspace");
  const workspaceId = (workspace.data.workspace as { id: string }).id;
  const root = `/api/workspaces/${workspaceId}`;
  for (const [cookie, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const) {
    const request = await api(`${root}/access-requests`, "POST", cookie, {});
    expected(request.status, 200, "access request");
    const requestId = (request.data.request as { id: string }).id;
    expected(
      (
        await api(
          `${root}/access-requests/${requestId}/decision`,
          "POST",
          owner,
          { decision: "approve", role },
        )
      ).status,
      200,
      "access approval",
    );
  }
  const manual = await api(
    `${root}/manual-expenses`,
    "POST",
    owner,
    {
      merchant: "Synthetic Market",
      date: "2026-10-30",
      totalMinor: 12300,
      currency: "UYU",
      lines: [
        {
          description: "Synthetic bread",
          quantityMilli: 1000,
          totalMinor: 12300,
        },
      ],
    },
    randomUUID(),
  );
  expected(manual.status, 201, "manual create");
  const manualId = (manual.data.expense as { id: string }).id;
  const path = `${root}/review/manual/${manualId}`;
  const first = await api(path, "GET", viewer);
  expected(first.status, 200, "viewer review read");
  const review = first.data.review as ReviewRecord;
  if (review.version !== 0 || review.original.merchant !== "Synthetic Market")
    throw new Error("incorrect initial review");
  const corrected = {
    ...review.current,
    merchant: "Synthetic Market Corrected",
    categoryName: "Food",
  };
  const body = {
    expectedVersion: 0,
    expectedBaseProposalId: null,
    reason: "Synthetic merchant correction",
    fields: corrected,
  };
  const key = randomUUID();
  expected(
    (await api(path, "PATCH", viewer, body, randomUUID())).status,
    403,
    "viewer correction denied",
  );
  expected(
    (await api(path, "PATCH", editor, body)).status,
    400,
    "missing idempotency key",
  );
  expected(
    (
      await api(
        path,
        "PATCH",
        editor,
        { ...body, fields: { ...corrected, totalMinor: -1 } },
        randomUUID(),
      )
    ).status,
    400,
    "negative money denied",
  );
  expected(
    (await api(path, "PATCH", editor, body, key)).status,
    200,
    "correction",
  );
  const retry = await api(path, "PATCH", editor, body, key);
  expected(retry.status, 200, "correction retry");
  if ((retry.data.review as ReviewRecord).version !== 1)
    throw new Error("retry made duplicate revision");
  expected(
    (
      await api(
        path,
        "PATCH",
        editor,
        { ...body, reason: "Different change" },
        key,
      )
    ).status,
    409,
    "conflicting retry",
  );
  expected(
    (
      await api(
        path,
        "PATCH",
        editor,
        { ...body, fields: { ...corrected, merchant: "Another" } },
        randomUUID(),
      )
    ).status,
    409,
    "stale version",
  );
  expected(
    (await api(`${root}/review/manual/${randomUUID()}`, "GET", viewer)).status,
    404,
    "foreign review hidden",
  );
  const second = await api(path, "GET", owner);
  expected(second.status, 200, "owner read");
  const final = second.data.review as ReviewRecord;
  if (
    final.version !== 1 ||
    final.revisions.length !== 1 ||
    final.revisions[0].before.merchant !== "Synthetic Market" ||
    final.revisions[0].after.merchant !== "Synthetic Market Corrected"
  )
    throw new Error("revision history wrong");
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
    "base64",
  );
  const sourceResponse = await fetch(new URL(`${root}/sources`, base), {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: owner,
      "Content-Type": "image/png",
      "X-Source-Filename": "synthetic-review.png",
      "Idempotency-Key": randomUUID(),
    },
    body: bytes,
  });
  expected(sourceResponse.status, 201, "source upload");
  const sourceId = ((await sourceResponse.json()) as { source: { id: string } })
    .source.id;
  const staged = await api(
    `${root}/receipts`,
    "POST",
    owner,
    { sourceIds: [sourceId] },
    randomUUID(),
  );
  expected(staged.status, 201, "receipt stage");
  const receiptId = (staged.data.receipt as { id: string }).id;
  expected(
    (
      await api(
        `${root}/receipts/${receiptId}/extraction-jobs`,
        "POST",
        owner,
        undefined,
        randomUUID(),
      )
    ).status,
    201,
    "receipt extraction submit",
  );
  let receiptReview: ReviewRecord | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await api(
      `${root}/review/receipt/${receiptId}`,
      "GET",
      owner,
    );
    if (response.status === 200) {
      receiptReview = response.data.review as ReviewRecord;
      break;
    }
    if (response.status !== 404)
      throw new Error(`receipt review read: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!receiptReview || receiptReview.version !== 0)
    throw new Error("receipt proposal unavailable");
  const receiptPath = `${root}/review/receipt/${receiptId}`;
  const receiptFields = {
    ...receiptReview.current,
    merchant: "Synthetic OCR Correction",
    totalMinor: 1000,
  };
  expected(
    (
      await api(
        receiptPath,
        "PATCH",
        editor,
        {
          expectedVersion: 0,
          expectedBaseProposalId: randomUUID(),
          reason: "Stale synthetic proposal",
          fields: receiptFields,
        },
        randomUUID(),
      )
    ).status,
    409,
    "stale proposal denied",
  );
  const receiptCorrection = await api(
    receiptPath,
    "PATCH",
    editor,
    {
      expectedVersion: 0,
      expectedBaseProposalId: receiptReview.baseProposalId,
      reason: "Synthetic OCR correction",
      fields: receiptFields,
    },
    randomUUID(),
  );
  expected(receiptCorrection.status, 200, "receipt correction");
  const updatedReceipt = receiptCorrection.data.review as ReviewRecord;
  if (
    updatedReceipt.version !== 1 ||
    updatedReceipt.revisions[0].before.merchant !==
      receiptReview.original.merchant
  )
    throw new Error("receipt proposal provenance lost");
  const pool = new Pool({ connectionString: loadAppConfig().databaseUrl });
  try {
    const count = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM review_audit_events WHERE workspace_id = $1",
      [workspaceId],
    );
    if (count.rows[0].n !== "2") throw new Error("audit count wrong");
    try {
      await pool.query("DELETE FROM review_revisions WHERE workspace_id = $1", [
        workspaceId,
      ]);
      throw new Error("immutable revision delete succeeded");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "immutable revision delete succeeded"
      )
        throw error;
    }
  } finally {
    await pool.end();
  }
  console.info("Synthetic review smoke passed.");
}
run().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Review smoke failed.",
  );
  process.exitCode = 1;
});
