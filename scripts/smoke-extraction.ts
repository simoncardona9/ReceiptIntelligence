import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { loadAppConfig } from "../src/server/config/app-config";

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

function expect(status: number, wanted: number, step: string) {
  if (status !== wanted)
    throw new Error(`${step}: expected ${wanted}, got ${status}`);
}

async function register() {
  const email = `synthetic-extract-${randomUUID()}@example.invalid`;
  expect(
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
  expect(login.status, 200, "login");
  return login.cookie!;
}

async function run() {
  const owner = await register();
  const workspace = await api(
    "/api/workspaces",
    "POST",
    owner,
    { name: "Synthetic Extraction" },
    randomUUID(),
  );
  expect(workspace.status, 201, "workspace");
  const workspaceId = (workspace.data.workspace as { id: string }).id;
  const path = `/api/workspaces/${workspaceId}`;
  const viewer = await register();
  const editor = await register();
  for (const [cookie, role] of [
    [viewer, "viewer"],
    [editor, "editor"],
  ] as const) {
    const request = await api(`${path}/access-requests`, "POST", cookie, {});
    expect(request.status, 200, `${role} access request`);
    const id = (request.data.request as { id: string }).id;
    expect(
      (
        await api(`${path}/access-requests/${id}/decision`, "POST", owner, {
          decision: "approve",
          role,
        })
      ).status,
      200,
      `${role} approval`,
    );
  }
  const bytes = process.env.OCR_SMOKE_SOURCE
    ? await readFile(process.env.OCR_SMOKE_SOURCE)
    : Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
        "base64",
      );
  const sourceResponse = await fetch(new URL(`${path}/sources`, base), {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: owner,
      "Content-Type": "image/png",
      "X-Source-Filename": "synthetic-ocr.png",
      "Idempotency-Key": randomUUID(),
    },
    body: bytes,
  });
  expect(sourceResponse.status, 201, "source upload");
  const source = (await sourceResponse.json()) as { source: { id: string } };
  const staged = await api(
    `${path}/receipts`,
    "POST",
    owner,
    { sourceIds: [source.source.id] },
    randomUUID(),
  );
  expect(staged.status, 201, "stage");
  const receiptId = (staged.data.receipt as { id: string }).id;

  expect(
    (
      await api(
        `${path}/extraction-queue/pause`,
        "POST",
        editor,
        {},
        randomUUID(),
      )
    ).status,
    403,
    "editor pause denied",
  );
  expect(
    (
      await api(
        `${path}/extraction-queue/pause`,
        "POST",
        owner,
        {},
        randomUUID(),
      )
    ).status,
    200,
    "owner pause",
  );
  const jobsPath = `${path}/receipts/${receiptId}/extraction-jobs`;
  expect(
    (await api(jobsPath, "POST", viewer, undefined, randomUUID())).status,
    403,
    "viewer submit denied",
  );
  const key = randomUUID();
  const submitted = await api(jobsPath, "POST", editor, undefined, key);
  expect(submitted.status, 201, "editor submit");
  const jobId = (submitted.data.job as { id: string }).id;
  const replay = await api(jobsPath, "POST", editor, undefined, key);
  expect(replay.status, 200, "submit replay");
  if ((replay.data.job as { id: string }).id !== jobId)
    throw new Error("submit replay changed job");
  const priorityPath = `${path}/extraction-jobs/${jobId}/priority`;
  expect(
    (await api(priorityPath, "POST", viewer, { priority: 5 }, randomUUID()))
      .status,
    403,
    "viewer priority denied",
  );
  const priorityKey = randomUUID();
  expect(
    (await api(priorityPath, "POST", editor, { priority: 5 }, priorityKey))
      .status,
    200,
    "editor priority",
  );
  expect(
    (await api(priorityPath, "POST", editor, { priority: 5 }, priorityKey))
      .status,
    200,
    "priority replay",
  );
  expect(
    (await api(priorityPath, "POST", editor, { priority: 6 }, priorityKey))
      .status,
    409,
    "priority key conflict",
  );
  expect(
    (
      await api(
        `${path}/extraction-jobs/${jobId}/cancel`,
        "POST",
        editor,
        {},
        randomUUID(),
      )
    ).status,
    403,
    "editor cancel denied",
  );
  const cancelKey = randomUUID();
  expect(
    (
      await api(
        `${path}/extraction-jobs/${jobId}/cancel`,
        "POST",
        owner,
        {},
        cancelKey,
      )
    ).status,
    200,
    "owner cancel",
  );
  expect(
    (
      await api(
        `${path}/extraction-jobs/${jobId}/cancel`,
        "POST",
        owner,
        {},
        cancelKey,
      )
    ).status,
    200,
    "cancel replay",
  );
  const second = await api(jobsPath, "POST", owner, undefined, randomUUID());
  expect(second.status, 201, "resubmit after cancel");
  const secondId = (second.data.job as { id: string }).id;
  expect(
    (
      await api(
        `${path}/extraction-queue/resume`,
        "POST",
        owner,
        {},
        randomUUID(),
      )
    ).status,
    200,
    "owner resume",
  );
  let finalStatus = "";
  for (let attempt = 0; attempt < 50; attempt++) {
    const queue = await api(`${path}/extraction-jobs`, "GET", owner);
    expect(queue.status, 200, "owner queue");
    const jobs = (
      queue.data.queue as { jobs: { id: string; status: string }[] }
    ).jobs;
    finalStatus = jobs.find((job) => job.id === secondId)?.status ?? "";
    if (finalStatus === "completed" || finalStatus === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (finalStatus !== "completed")
    throw new Error(`OCR job did not complete: ${finalStatus}`);
  const viewerQueue = await api(`${path}/extraction-jobs`, "GET", viewer);
  expect(viewerQueue.status, 200, "viewer queue read");
  const viewerJobs = (
    viewerQueue.data.queue as { jobs: { safeErrorCode: string | null }[] }
  ).jobs;
  if (viewerJobs.some((job) => job.safeErrorCode !== null))
    throw new Error("viewer saw error detail");
  const proposalPath = `${path}/receipts/${receiptId}/proposal`;
  const proposalResponse = await api(proposalPath, "GET", viewer);
  expect(proposalResponse.status, 200, "viewer proposal read");
  const proposal = (
    proposalResponse.data.stored as {
      proposal: {
        version: number;
        warnings: string[];
        fields: {
          totalMinor: {
            normalized: number;
            evidence: { sourceId: string };
          } | null;
          currency: { normalized: string } | null;
        };
        lineItems: unknown[];
      };
    }
  ).proposal;
  if (
    proposal.version !== 1 ||
    (!process.env.OCR_SMOKE_SOURCE &&
      !proposal.warnings.includes("MISSING_TOTAL_MINOR"))
  )
    throw new Error("source did not produce a reviewable proposal");
  if (
    process.env.OCR_SMOKE_SOURCE &&
    (proposal.fields.totalMinor?.normalized !== 24300 ||
      proposal.fields.totalMinor.evidence.sourceId !== source.source.id ||
      proposal.fields.currency?.normalized !== "UYU" ||
      proposal.lineItems.length !== 2)
  )
    throw new Error(
      "synthetic OCR proposal lost amount, currency, lines, or source provenance",
    );
  expect(
    (
      await api(
        `/api/workspaces/${randomUUID()}/receipts/${receiptId}/proposal`,
        "GET",
        viewer,
      )
    ).status,
    404,
    "foreign proposal scope",
  );
  expect(
    (
      await api(
        `${path}/extraction-queue/pause`,
        "POST",
        owner,
        {},
        randomUUID(),
      )
    ).status,
    200,
    "pause before source removal",
  );
  const removedBytes = Buffer.from(bytes);
  removedBytes[removedBytes.length - 1] ^= 1;
  const removedUpload = await fetch(new URL(`${path}/sources`, base), {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: owner,
      "Content-Type": "image/png",
      "X-Source-Filename": "synthetic-to-remove.png",
      "Idempotency-Key": randomUUID(),
    },
    body: removedBytes,
  });
  expect(removedUpload.status, 201, "source for removal");
  const removedSourceId = (
    (await removedUpload.json()) as { source: { id: string } }
  ).source.id;
  const removedStage = await api(
    `${path}/receipts`,
    "POST",
    owner,
    { sourceIds: [removedSourceId] },
    randomUUID(),
  );
  expect(removedStage.status, 201, "stage before removal");
  const removedReceiptId = (removedStage.data.receipt as { id: string }).id;
  expect(
    (await api(`${path}/sources/${removedSourceId}`, "DELETE", owner)).status,
    200,
    "source removal",
  );
  const removedJobResponse = await api(
    `${path}/receipts/${removedReceiptId}/extraction-jobs`,
    "POST",
    owner,
    undefined,
    randomUUID(),
  );
  expect(removedJobResponse.status, 201, "submit removed source");
  const removedJobId = (removedJobResponse.data.job as { id: string }).id;
  expect(
    (
      await api(
        `${path}/extraction-queue/resume`,
        "POST",
        owner,
        {},
        randomUUID(),
      )
    ).status,
    200,
    "resume after source removal",
  );
  let removedStatus = "";
  for (let attempt = 0; attempt < 50; attempt++) {
    const snapshot = await api(`${path}/extraction-jobs`, "GET", owner);
    removedStatus =
      (
        snapshot.data.queue as { jobs: { id: string; status: string }[] }
      ).jobs.find((job) => job.id === removedJobId)?.status ?? "";
    if (removedStatus === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (removedStatus !== "failed")
    throw new Error("removed source did not fail safely");
  const pool = new Pool({ connectionString: loadAppConfig().databaseUrl });
  try {
    const evidence = await pool.query(
      "SELECT 1 FROM extraction_evidence WHERE job_id = $1 AND workspace_id = $2",
      [secondId, workspaceId],
    );
    if (evidence.rowCount !== 1)
      throw new Error("completed job lacks evidence");
    const stored = await pool.query<{ id: string }>(
      "SELECT id FROM receipt_proposals WHERE job_id = $1 AND workspace_id = $2",
      [secondId, workspaceId],
    );
    if (stored.rowCount !== 1) throw new Error("completed job lacks proposal");
    const receipt = await pool.query<{ status: string }>(
      "SELECT status FROM receipts WHERE id = $1 AND workspace_id = $2",
      [receiptId, workspaceId],
    );
    if (receipt.rows[0]?.status !== "review")
      throw new Error("receipt is not in review state");
    const cancelled = await pool.query(
      "SELECT 1 FROM extraction_evidence WHERE job_id = $1",
      [jobId],
    );
    if (cancelled.rowCount) throw new Error("cancelled job retained evidence");
    const cancelledProposal = await pool.query(
      "SELECT 1 FROM receipt_proposals WHERE job_id = $1",
      [jobId],
    );
    if (cancelledProposal.rowCount)
      throw new Error("cancelled job retained proposal");
    const removedEvidence = await pool.query(
      "SELECT 1 FROM extraction_evidence WHERE job_id = $1",
      [removedJobId],
    );
    const removedProposal = await pool.query(
      "SELECT 1 FROM receipt_proposals WHERE job_id = $1",
      [removedJobId],
    );
    if (removedEvidence.rowCount || removedProposal.rowCount)
      throw new Error("removed source left partial extraction data");
    const event = await pool.query<{ id: string }>(
      "SELECT id FROM extraction_job_events WHERE job_id = $1 AND action = 'completed'",
      [secondId],
    );
    if (event.rowCount !== 1)
      throw new Error("completed job lacks audit event");
    try {
      await pool.query("DELETE FROM extraction_job_events WHERE id = $1", [
        event.rows[0].id,
      ]);
      throw new Error("audit event was mutable");
    } catch (error) {
      if (error instanceof Error && error.message === "audit event was mutable")
        throw error;
    }
    try {
      await pool.query("DELETE FROM receipt_proposals WHERE id = $1", [
        stored.rows[0].id,
      ]);
      throw new Error("proposal was mutable");
    } catch (error) {
      if (error instanceof Error && error.message === "proposal was mutable")
        throw error;
    }
  } finally {
    await pool.end();
  }
  console.info("Synthetic extraction smoke passed.");
}

run().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Extraction smoke failed.",
  );
  process.exitCode = 1;
});
