import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadAppConfig } from "../src/server/config/app-config";
import { PostgresExtractionQueueRepository } from "../src/server/adapters/postgres/extraction-queue-repository";

async function run() {
  const pool = new Pool({ connectionString: loadAppConfig().databaseUrl });
  const repository = new PostgresExtractionQueueRepository(pool);
  try {
    const owner = await pool.query<{
      workspaceId: string;
      actorUserId: string;
    }>(
      `SELECT r.workspace_id AS "workspaceId", r.created_by AS "actorUserId"
       FROM receipts r JOIN memberships m ON m.workspace_id = r.workspace_id
       AND m.user_id = r.created_by AND m.role = 'owner'
       ORDER BY r.created_at DESC LIMIT 1`,
    );
    if (!owner.rows[0]) throw new Error("Run smoke:extraction first.");
    const { workspaceId, actorUserId } = owner.rows[0];
    async function syntheticReceipt() {
      const receiptId = randomUUID();
      const fingerprint = createHash("sha256").update(receiptId).digest("hex");
      await pool.query(
        `INSERT INTO receipts (id, workspace_id, source_fingerprint, created_by)
        VALUES ($1,$2,$3,$4)`,
        [receiptId, workspaceId, fingerprint, actorUserId],
      );
      return receiptId;
    }
    const receiptId = await syntheticReceipt();
    const submitted = await repository.submit(
      workspaceId,
      actorUserId,
      receiptId,
      randomUUID(),
    );
    await repository.prioritize(
      workspaceId,
      actorUserId,
      submitted.job.id,
      10,
      randomUUID(),
    );
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claimed = await repository.claim();
      if (!claimed || claimed.jobId !== submitted.job.id)
        throw new Error("Claim order incorrect.");
      await repository.fail(claimed, "ENGINE_FAILED", true, false);
      const state = await pool.query<{
        status: string;
        attempts: number;
        nextAttemptAt: Date;
      }>(
        `SELECT status, attempts, next_attempt_at AS "nextAttemptAt"
         FROM extraction_jobs WHERE id = $1`,
        [submitted.job.id],
      );
      if (
        state.rows[0].attempts !== attempt ||
        state.rows[0].status !== (attempt < 5 ? "retry_wait" : "failed")
      )
        throw new Error("Attempt state incorrect.");
      if (attempt < 5) {
        const minimum = 60 * 2 ** (attempt - 1) - 5;
        if (state.rows[0].nextAttemptAt.getTime() - Date.now() < minimum * 1000)
          throw new Error("Backoff too short.");
        await pool.query(
          "UPDATE extraction_jobs SET next_attempt_at = now() WHERE id = $1",
          [submitted.job.id],
        );
      }
    }
    const events = await pool.query<{ action: string; count: string }>(
      `SELECT action, count(*)::text AS count FROM extraction_job_events
       WHERE job_id = $1 GROUP BY action`,
      [submitted.job.id],
    );
    const counts = new Map(
      events.rows.map((row) => [row.action, Number(row.count)]),
    );
    if (
      counts.get("started") !== 5 ||
      counts.get("retry_scheduled") !== 4 ||
      counts.get("failed") !== 1
    )
      throw new Error("Attempt audit incorrect.");
    const secondReceipt = await syntheticReceipt();
    const secondJob = await repository.submit(
      workspaceId,
      actorUserId,
      secondReceipt,
      randomUUID(),
    );
    await repository.prioritize(
      workspaceId,
      actorUserId,
      secondJob.job.id,
      10,
      randomUUID(),
    );
    const running = await repository.claim();
    if (running?.jobId !== secondJob.job.id)
      throw new Error("Recovery claim incorrect.");
    await repository.recover();
    const recovered = await pool.query<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM extraction_jobs WHERE id = $1",
      [secondJob.job.id],
    );
    if (
      recovered.rows[0].status !== "retry_wait" ||
      recovered.rows[0].attempts !== 1
    )
      throw new Error("Restart recovery incorrect.");
    const evidence = await pool.query(
      "SELECT 1 FROM extraction_evidence WHERE job_id = $1",
      [secondJob.job.id],
    );
    if (evidence.rowCount)
      throw new Error("Recovered job retained partial evidence.");
    await repository.cancel(
      workspaceId,
      actorUserId,
      secondJob.job.id,
      randomUUID(),
    );

    const resourceReceipt = await syntheticReceipt();
    const resourceJob = await repository.submit(
      workspaceId,
      actorUserId,
      resourceReceipt,
      randomUUID(),
    );
    await repository.prioritize(
      workspaceId,
      actorUserId,
      resourceJob.job.id,
      10,
      randomUUID(),
    );
    const resourceRun = await repository.claim();
    if (resourceRun?.jobId !== resourceJob.job.id)
      throw new Error("Resource claim incorrect.");
    await repository.fail(resourceRun, "RESOURCE_FAILURE", true, true);
    const paused = await repository.list(workspaceId, actorUserId);
    if (
      !paused.paused ||
      !paused.resourcePaused ||
      paused.jobs.find((job) => job.id === resourceJob.job.id)?.status !==
        "failed"
    )
      throw new Error("Resource failure did not pause queue and fail job.");
    await repository.setPaused(workspaceId, actorUserId, false, randomUUID());

    const stoppedReceipt = await syntheticReceipt();
    const stoppedJob = await repository.submit(
      workspaceId,
      actorUserId,
      stoppedReceipt,
      randomUUID(),
    );
    await repository.prioritize(
      workspaceId,
      actorUserId,
      stoppedJob.job.id,
      10,
      randomUUID(),
    );
    const stoppedRun = await repository.claim();
    if (stoppedRun?.jobId !== stoppedJob.job.id)
      throw new Error("Pause claim incorrect.");
    await repository.setPaused(workspaceId, actorUserId, true, randomUUID());
    const stopped = await repository.list(workspaceId, actorUserId);
    if (
      stopped.jobs.find((job) => job.id === stoppedJob.job.id)?.status !==
      "stopped"
    )
      throw new Error("Pause did not stop running job.");
    const staleComplete = await repository.complete(stoppedRun, {
      version: 1,
      engine: "tesseract",
      device: "cpu",
      pages: [],
      diagnostics: { durationMs: 0 },
    });
    if (staleComplete) throw new Error("Stopped run stored stale evidence.");
    await repository.setPaused(workspaceId, actorUserId, false, randomUUID());
    const retried = await repository.retry(
      workspaceId,
      actorUserId,
      stoppedJob.job.id,
      randomUUID(),
    );
    if (retried.status !== "queued" || retried.attempts !== 0)
      throw new Error("Manual retry did not reset attempt budget.");
    await repository.cancel(
      workspaceId,
      actorUserId,
      stoppedJob.job.id,
      randomUUID(),
    );
    console.info("Synthetic queue state smoke passed.");
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Queue state smoke failed.",
  );
  process.exitCode = 1;
});
