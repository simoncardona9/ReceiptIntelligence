import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { ExtractionResult } from "@/server/extraction/contracts";
import type { SourceMediaType } from "@/server/storage/contracts";

export type JobStatus =
  | "queued"
  | "running"
  | "retry_wait"
  | "failed"
  | "completed"
  | "cancelled"
  | "stopped";
export type QueueJob = {
  id: string;
  receiptId: string;
  workspaceId: string;
  status: JobStatus;
  attempts: number;
  priority: number;
  safeErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
};
export type QueueSnapshot = {
  paused: boolean;
  resourcePaused: boolean;
  role: WorkspaceRole;
  jobs: QueueJob[];
};
export type ClaimedJob = {
  jobId: string;
  receiptId: string;
  workspaceId: string;
  runToken: string;
  sources: { id: string; storageKey: string; mediaType: SourceMediaType }[];
};

type JobRow = {
  id: string;
  receiptId: string;
  workspaceId: string;
  status: JobStatus;
  attempts: number;
  priority: number;
  safeErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  nextAttemptAt: Date;
};

function toJob(row: JobRow, showError: boolean): QueueJob {
  return {
    id: row.id,
    receiptId: row.receiptId,
    workspaceId: row.workspaceId,
    status: row.status,
    attempts: row.attempts,
    priority: row.priority,
    safeErrorCode: showError ? row.safeErrorCode : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt.toISOString(),
  };
}

export class PostgresExtractionQueueRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async role(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    permission: "read" | "edit" | "manage_access",
  ): Promise<WorkspaceRole> {
    const result = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorUserId],
    );
    const role = result.rows[0]?.role ?? null;
    requireWorkspacePermission(role, permission);
    return role!;
  }

  private async event(
    client: PoolClient,
    workspaceId: string,
    action: string,
    jobId: string | null,
    receiptId: string | null,
    actorUserId: string | null,
    safeErrorCode: string | null = null,
  ) {
    await client.query(
      `INSERT INTO extraction_job_events
      (id, workspace_id, job_id, receipt_id, actor_user_id, action, safe_error_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        workspaceId,
        jobId,
        receiptId,
        actorUserId,
        action,
        safeErrorCode,
      ],
    );
  }

  private async actionRequest(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    key: string,
    action: string,
    targetId: string | null,
    value: string | null,
  ): Promise<boolean> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`extract-action:${workspaceId}:${actorUserId}:${key}`],
    );
    const prior = await client.query<{
      action: string;
      targetId: string | null;
      value: string | null;
    }>(
      `SELECT action, target_id AS "targetId", value FROM extraction_action_requests
       WHERE workspace_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
      [workspaceId, actorUserId, key],
    );
    if (prior.rows[0]) {
      if (
        prior.rows[0].action !== action ||
        prior.rows[0].targetId !== targetId ||
        prior.rows[0].value !== value
      )
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "Request key already used.",
        );
      return true;
    }
    await client.query(
      `INSERT INTO extraction_action_requests
      (workspace_id, actor_user_id, idempotency_key, action, target_id, value)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [workspaceId, actorUserId, key, action, targetId, value],
    );
    return false;
  }

  private async job(
    client: PoolClient,
    workspaceId: string,
    jobId: string,
    lock = false,
  ): Promise<JobRow> {
    const result = await client.query<JobRow>(
      `SELECT id, receipt_id AS "receiptId",
      workspace_id AS "workspaceId", status, attempts, priority,
      safe_error_code AS "safeErrorCode", created_at AS "createdAt",
      updated_at AS "updatedAt", next_attempt_at AS "nextAttemptAt"
      FROM extraction_jobs WHERE workspace_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`,
      [workspaceId, jobId],
    );
    if (!result.rows[0])
      throw new DomainError("JOB_NOT_FOUND", 404, "Job not found.");
    return result.rows[0];
  }

  async submit(
    workspaceId: string,
    actorUserId: string,
    receiptId: string,
    idempotencyKey: string,
  ): Promise<{ job: QueueJob; created: boolean }> {
    return this.transaction(async (client) => {
      await this.role(client, workspaceId, actorUserId, "edit");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`extract:${workspaceId}:${actorUserId}:${idempotencyKey}`],
      );
      const receipt = await client.query<{ status: string }>(
        "SELECT status FROM receipts WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [workspaceId, receiptId],
      );
      if (!receipt.rows[0])
        throw new DomainError("RECEIPT_NOT_FOUND", 404, "Receipt not found.");
      const prior = await client.query<{ receiptId: string; jobId: string }>(
        `SELECT receipt_id AS "receiptId", job_id AS "jobId" FROM extraction_job_requests
         WHERE workspace_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
        [workspaceId, actorUserId, idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].receiptId !== receiptId)
          throw new DomainError(
            "IDEMPOTENCY_KEY_REUSED",
            409,
            "Request key already used.",
          );
        return {
          job: toJob(
            await this.job(client, workspaceId, prior.rows[0].jobId),
            true,
          ),
          created: false,
        };
      }
      const active = await client.query<{ id: string }>(
        `SELECT id FROM extraction_jobs WHERE workspace_id = $1 AND receipt_id = $2
         AND status IN ('queued','running','retry_wait') LIMIT 1`,
        [workspaceId, receiptId],
      );
      if (
        !active.rows[0] &&
        !["staged", "failed", "extracted"].includes(receipt.rows[0].status)
      )
        throw new DomainError(
          "RECEIPT_NOT_EXTRACTABLE",
          409,
          "Receipt cannot be extracted now.",
        );
      const jobId = active.rows[0]?.id ?? randomUUID();
      let created = false;
      if (!active.rows[0]) {
        await client.query(
          `INSERT INTO extraction_jobs (id, workspace_id, receipt_id, requested_by)
          VALUES ($1,$2,$3,$4)`,
          [jobId, workspaceId, receiptId, actorUserId],
        );
        await this.event(
          client,
          workspaceId,
          "submitted",
          jobId,
          receiptId,
          actorUserId,
        );
        created = true;
      }
      await client.query(
        `INSERT INTO extraction_job_requests
        (workspace_id, actor_user_id, idempotency_key, receipt_id, job_id)
        VALUES ($1,$2,$3,$4,$5)`,
        [workspaceId, actorUserId, idempotencyKey, receiptId, jobId],
      );
      return {
        job: toJob(await this.job(client, workspaceId, jobId), true),
        created,
      };
    });
  }

  async list(workspaceId: string, actorUserId: string): Promise<QueueSnapshot> {
    const client = await this.pool.connect();
    try {
      const role = await this.role(client, workspaceId, actorUserId, "read");
      const control = await client.query<{
        paused: boolean;
        resourcePaused: boolean;
      }>(
        `SELECT paused, resource_paused AS "resourcePaused" FROM extraction_queue_controls
         WHERE workspace_id = $1`,
        [workspaceId],
      );
      const jobs = await client.query<JobRow>(
        `SELECT id, receipt_id AS "receiptId",
        workspace_id AS "workspaceId", status, attempts, priority,
        safe_error_code AS "safeErrorCode", created_at AS "createdAt",
        updated_at AS "updatedAt", next_attempt_at AS "nextAttemptAt"
        FROM extraction_jobs WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
        [workspaceId],
      );
      return {
        role,
        paused: control.rows[0]?.paused ?? false,
        resourcePaused: control.rows[0]?.resourcePaused ?? false,
        jobs: jobs.rows.map((job) => toJob(job, role === "owner")),
      };
    } finally {
      client.release();
    }
  }

  async prioritize(
    workspaceId: string,
    actorUserId: string,
    jobId: string,
    priority: number,
    key: string,
  ): Promise<QueueJob> {
    return this.transaction(async (client) => {
      await this.role(client, workspaceId, actorUserId, "edit");
      const replay = await this.actionRequest(
        client,
        workspaceId,
        actorUserId,
        key,
        "prioritize",
        jobId,
        String(priority),
      );
      const job = await this.job(client, workspaceId, jobId, true);
      if (replay) return toJob(job, true);
      if (!["queued", "retry_wait"].includes(job.status))
        throw new DomainError(
          "JOB_STATE_CONFLICT",
          409,
          "Job cannot be prioritized.",
        );
      if (job.priority !== priority) {
        await client.query(
          "UPDATE extraction_jobs SET priority = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2",
          [workspaceId, jobId, priority],
        );
        await this.event(
          client,
          workspaceId,
          "prioritized",
          jobId,
          job.receiptId,
          actorUserId,
        );
      }
      return toJob(await this.job(client, workspaceId, jobId), true);
    });
  }

  async retry(
    workspaceId: string,
    actorUserId: string,
    jobId: string,
    key: string,
  ): Promise<QueueJob> {
    return this.transaction(async (client) => {
      await this.role(client, workspaceId, actorUserId, "edit");
      const replay = await this.actionRequest(
        client,
        workspaceId,
        actorUserId,
        key,
        "retry",
        jobId,
        null,
      );
      const job = await this.job(client, workspaceId, jobId, true);
      if (replay) return toJob(job, true);
      if (!["failed", "stopped"].includes(job.status))
        throw new DomainError(
          "JOB_STATE_CONFLICT",
          409,
          "Job cannot be retried.",
        );
      const active = await client.query(
        "SELECT 1 FROM extraction_jobs WHERE workspace_id = $1 AND receipt_id = $2 AND status IN ('queued','running','retry_wait')",
        [workspaceId, job.receiptId],
      );
      if (active.rowCount)
        throw new DomainError(
          "JOB_STATE_CONFLICT",
          409,
          "Receipt already has an active job.",
        );
      await client.query(
        `UPDATE extraction_jobs SET status = 'queued', attempts = 0,
        next_attempt_at = now(), safe_error_code = NULL, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, jobId],
      );
      await client.query(
        "UPDATE receipts SET status = 'staged' WHERE workspace_id = $1 AND id = $2",
        [workspaceId, job.receiptId],
      );
      await this.event(
        client,
        workspaceId,
        "manual_retry",
        jobId,
        job.receiptId,
        actorUserId,
      );
      return toJob(await this.job(client, workspaceId, jobId), true);
    });
  }

  async cancel(
    workspaceId: string,
    actorUserId: string,
    jobId: string,
    key: string,
  ): Promise<QueueJob> {
    return this.transaction(async (client) => {
      await this.role(client, workspaceId, actorUserId, "manage_access");
      const replay = await this.actionRequest(
        client,
        workspaceId,
        actorUserId,
        key,
        "cancel",
        jobId,
        null,
      );
      const job = await this.job(client, workspaceId, jobId, true);
      if (replay) return toJob(job, true);
      if (job.status === "cancelled") return toJob(job, true);
      if (!["queued", "running", "retry_wait"].includes(job.status))
        throw new DomainError(
          "JOB_STATE_CONFLICT",
          409,
          "Job cannot be cancelled.",
        );
      await client.query(
        `UPDATE extraction_jobs SET status = 'cancelled', run_token = NULL,
        updated_at = now(), completed_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, jobId],
      );
      await client.query(
        "UPDATE receipts SET status = 'staged' WHERE workspace_id = $1 AND id = $2",
        [workspaceId, job.receiptId],
      );
      await this.event(
        client,
        workspaceId,
        "cancelled",
        jobId,
        job.receiptId,
        actorUserId,
      );
      return toJob(await this.job(client, workspaceId, jobId), true);
    });
  }

  async setPaused(
    workspaceId: string,
    actorUserId: string,
    paused: boolean,
    key: string,
  ): Promise<void> {
    await this.transaction(async (client) => {
      await this.role(client, workspaceId, actorUserId, "manage_access");
      const replay = await this.actionRequest(
        client,
        workspaceId,
        actorUserId,
        key,
        paused ? "pause" : "resume",
        null,
        null,
      );
      if (replay) return;
      await client.query(
        `INSERT INTO extraction_queue_controls (workspace_id)
        VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`,
        [workspaceId],
      );
      const current = await client.query<{
        paused: boolean;
        resourcePaused: boolean;
      }>(
        `SELECT paused, resource_paused AS "resourcePaused" FROM extraction_queue_controls
         WHERE workspace_id = $1 FOR UPDATE`,
        [workspaceId],
      );
      if (
        current.rows[0].paused === paused &&
        (!current.rows[0].resourcePaused || paused)
      )
        return;
      await client.query(
        `UPDATE extraction_queue_controls SET paused = $2,
        resource_paused = false, updated_at = now() WHERE workspace_id = $1`,
        [workspaceId, paused],
      );
      if (paused) {
        const running = await client.query<{ id: string; receiptId: string }>(
          `UPDATE extraction_jobs SET status = 'stopped', run_token = NULL,
           updated_at = now(), completed_at = now() WHERE workspace_id = $1 AND status = 'running'
           RETURNING id, receipt_id AS "receiptId"`,
          [workspaceId],
        );
        for (const job of running.rows) {
          await client.query(
            "UPDATE receipts SET status = 'failed' WHERE workspace_id = $1 AND id = $2",
            [workspaceId, job.receiptId],
          );
          await this.event(
            client,
            workspaceId,
            "stopped",
            job.id,
            job.receiptId,
            actorUserId,
          );
        }
      }
      await this.event(
        client,
        workspaceId,
        paused ? "queue_paused" : "queue_resumed",
        null,
        null,
        actorUserId,
      );
    });
  }

  async claim(): Promise<ClaimedJob | null> {
    return this.transaction(async (client) => {
      const found = await client.query<{
        id: string;
        receiptId: string;
        workspaceId: string;
      }>(
        `SELECT j.id, j.receipt_id AS "receiptId", j.workspace_id AS "workspaceId"
         FROM extraction_jobs j LEFT JOIN extraction_queue_controls c ON c.workspace_id = j.workspace_id
         WHERE j.status IN ('queued','retry_wait') AND j.next_attempt_at <= now()
           AND coalesce(c.paused, false) = false
         ORDER BY j.priority DESC, j.next_attempt_at, j.created_at
         FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
      );
      const job = found.rows[0];
      if (!job) return null;
      const token = randomUUID();
      await client.query(
        `UPDATE extraction_jobs SET status = 'running', attempts = attempts + 1,
        run_token = $2, started_at = now(), updated_at = now(), safe_error_code = NULL
        WHERE id = $1`,
        [job.id, token],
      );
      await client.query(
        "UPDATE receipts SET status = 'processing' WHERE workspace_id = $1 AND id = $2",
        [job.workspaceId, job.receiptId],
      );
      await this.event(
        client,
        job.workspaceId,
        "started",
        job.id,
        job.receiptId,
        null,
      );
      const sources = await client.query<{
        id: string;
        storageKey: string;
        mediaType: SourceMediaType;
      }>(
        `SELECT s.id, s.storage_key AS "storageKey", s.media_type AS "mediaType"
         FROM receipt_sources rs JOIN source_files s ON s.id = rs.source_file_id
         WHERE rs.workspace_id = $1 AND rs.receipt_id = $2 AND s.removed_at IS NULL
         ORDER BY rs.position`,
        [job.workspaceId, job.receiptId],
      );
      return {
        jobId: job.id,
        receiptId: job.receiptId,
        workspaceId: job.workspaceId,
        runToken: token,
        sources: sources.rows,
      };
    });
  }

  async isRunning(jobId: string, runToken: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM extraction_jobs WHERE id = $1 AND run_token = $2 AND status = 'running'",
      [jobId, runToken],
    );
    return Boolean(result.rowCount);
  }

  async complete(job: ClaimedJob, result: ExtractionResult): Promise<boolean> {
    return this.transaction(async (client) => {
      const current = await client.query(
        "SELECT 1 FROM extraction_jobs WHERE id = $1 AND workspace_id = $2 AND run_token = $3 AND status = 'running' FOR UPDATE",
        [job.jobId, job.workspaceId, job.runToken],
      );
      if (!current.rowCount) return false;
      await client.query(
        `INSERT INTO extraction_evidence
        (job_id, workspace_id, receipt_id, schema_version, engine, device, pages, duration_ms)
        VALUES ($1,$2,$3,1,$4,$5,$6,$7)`,
        [
          job.jobId,
          job.workspaceId,
          job.receiptId,
          result.engine,
          result.device,
          JSON.stringify(result.pages),
          Math.round(result.diagnostics.durationMs),
        ],
      );
      await client.query(
        `UPDATE extraction_jobs SET status = 'completed', run_token = NULL,
        completed_at = now(), updated_at = now() WHERE id = $1`,
        [job.jobId],
      );
      await client.query(
        "UPDATE receipts SET status = 'extracted' WHERE workspace_id = $1 AND id = $2",
        [job.workspaceId, job.receiptId],
      );
      await this.event(
        client,
        job.workspaceId,
        "completed",
        job.jobId,
        job.receiptId,
        null,
      );
      return true;
    });
  }

  async fail(
    job: ClaimedJob,
    code: string,
    retryable: boolean,
    resourceFailure: boolean,
  ): Promise<void> {
    await this.transaction(async (client) => {
      if (resourceFailure) {
        await client.query(
          `INSERT INTO extraction_queue_controls (workspace_id)
          VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`,
          [job.workspaceId],
        );
        await client.query(
          `SELECT 1 FROM extraction_queue_controls
          WHERE workspace_id = $1 FOR UPDATE`,
          [job.workspaceId],
        );
      }
      const current = await client.query<{ attempts: number }>(
        "SELECT attempts FROM extraction_jobs WHERE id = $1 AND workspace_id = $2 AND run_token = $3 AND status = 'running' FOR UPDATE",
        [job.jobId, job.workspaceId, job.runToken],
      );
      if (!current.rows[0]) return;
      const retry =
        retryable && !resourceFailure && current.rows[0].attempts < 5;
      const delay = Math.min(3600, 60 * 2 ** (current.rows[0].attempts - 1));
      await client.query(
        `UPDATE extraction_jobs SET status = $2, run_token = NULL,
        safe_error_code = $3, next_attempt_at = CASE WHEN $4 THEN now() + ($5::int * interval '1 second') ELSE next_attempt_at END,
        completed_at = CASE WHEN $4 THEN NULL ELSE now() END, updated_at = now()
        WHERE id = $1`,
        [job.jobId, retry ? "retry_wait" : "failed", code, retry, delay],
      );
      await client.query(
        "UPDATE receipts SET status = $3 WHERE workspace_id = $1 AND id = $2",
        [job.workspaceId, job.receiptId, retry ? "processing" : "failed"],
      );
      await this.event(
        client,
        job.workspaceId,
        retry ? "retry_scheduled" : "failed",
        job.jobId,
        job.receiptId,
        null,
        code,
      );
      if (resourceFailure) {
        await client.query(
          `INSERT INTO extraction_queue_controls (workspace_id, paused, resource_paused)
          VALUES ($1,true,true) ON CONFLICT (workspace_id) DO UPDATE SET paused = true,
          resource_paused = true, updated_at = now()`,
          [job.workspaceId],
        );
        await this.event(
          client,
          job.workspaceId,
          "resource_paused",
          job.jobId,
          job.receiptId,
          null,
          code,
        );
      }
    });
  }

  async recover(): Promise<void> {
    await this.transaction(async (client) => {
      const running = await client.query<{
        id: string;
        workspaceId: string;
        receiptId: string;
        attempts: number;
      }>(
        `SELECT id, workspace_id AS "workspaceId", receipt_id AS "receiptId", attempts
         FROM extraction_jobs WHERE status = 'running' FOR UPDATE`,
      );
      for (const job of running.rows) {
        const retry = job.attempts < 5;
        await client.query(
          `UPDATE extraction_jobs SET status = $2, run_token = NULL,
          safe_error_code = 'WORKER_RESTARTED', next_attempt_at = now(), updated_at = now(),
          completed_at = CASE WHEN $3 THEN NULL ELSE now() END WHERE id = $1`,
          [job.id, retry ? "retry_wait" : "failed", retry],
        );
        await client.query(
          "UPDATE receipts SET status = $3 WHERE workspace_id = $1 AND id = $2",
          [job.workspaceId, job.receiptId, retry ? "processing" : "failed"],
        );
        await this.event(
          client,
          job.workspaceId,
          "recovered",
          job.id,
          job.receiptId,
          null,
          "WORKER_RESTARTED",
        );
      }
    });
  }
}
