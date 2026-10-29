import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";

export type StagedReceipt = {
  id: string;
  workspaceId: string;
  status: "staged" | "processing" | "failed" | "extracted" | "review";
  sourceIds: string[];
  createdAt: string;
};

export type IntakeFacts = {
  merchant: string;
  date: string;
  totalMinor: number;
  currency: "UYU" | "USD";
};

export function merchantKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

type ReceiptRow = {
  id: string;
  workspaceId: string;
  status: StagedReceipt["status"];
  createdAt: Date;
};

export class ReceiptService {
  constructor(private readonly pool: Pool) {}

  async stage(input: {
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    sourceIds: string[];
    facts?: IntakeFacts;
  }): Promise<{ receipt: StagedReceipt; created: boolean }> {
    if (
      input.sourceIds.length < 1 ||
      input.sourceIds.length > 20 ||
      new Set(input.sourceIds).size !== input.sourceIds.length
    ) {
      throw new DomainError(
        "INVALID_SOURCES",
        400,
        "Provide 1 to 20 distinct sources.",
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.authorize(
        client,
        input.workspaceId,
        input.actorUserId,
        "edit",
      );
      const sources = await client.query<{ id: string; contentHash: string }>(
        `SELECT id, content_hash AS "contentHash" FROM source_files
         WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND removed_at IS NULL FOR SHARE`,
        [input.workspaceId, input.sourceIds],
      );
      if (sources.rowCount !== input.sourceIds.length)
        throw new DomainError(
          "SOURCE_NOT_FOUND",
          404,
          "Source file not found.",
        );
      const hashes = new Map(
        sources.rows.map((row) => [row.id, row.contentHash]),
      );
      const fingerprint = createHash("sha256")
        .update(input.sourceIds.map((id) => hashes.get(id)).join(":"), "utf8")
        .digest("hex");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          `receipt:${input.workspaceId}:${input.actorUserId}:${input.idempotencyKey}`,
        ],
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`receipt-content:${input.workspaceId}:${fingerprint}`],
      );
      const prior = await client.query<{
        sourceFingerprint: string;
        receiptId: string;
      }>(
        `SELECT source_fingerprint AS "sourceFingerprint", receipt_id AS "receiptId" FROM receipt_intake_requests
         WHERE workspace_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
        [input.workspaceId, input.actorUserId, input.idempotencyKey],
      );
      if (prior.rows[0] && prior.rows[0].sourceFingerprint !== fingerprint)
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "This request key was already used for different sources.",
        );
      let receiptId = prior.rows[0]?.receiptId;
      let created = false;
      if (!receiptId) {
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM receipts WHERE workspace_id = $1 AND source_fingerprint = $2",
          [input.workspaceId, fingerprint],
        );
        receiptId = existing.rows[0]?.id;
        if (!receiptId) {
          receiptId = randomUUID();
          await client.query(
            "INSERT INTO receipts (id, workspace_id, source_fingerprint, created_by) VALUES ($1,$2,$3,$4)",
            [receiptId, input.workspaceId, fingerprint, input.actorUserId],
          );
          for (const [position, sourceId] of input.sourceIds.entries()) {
            await client.query(
              "INSERT INTO receipt_sources (receipt_id, workspace_id, source_file_id, position) VALUES ($1,$2,$3,$4)",
              [receiptId, input.workspaceId, sourceId, position],
            );
          }
          await client.query(
            "INSERT INTO receipt_intake_audit_events (id, workspace_id, actor_user_id, receipt_id, action) VALUES ($1,$2,$3,$4,'receipt_staged')",
            [randomUUID(), input.workspaceId, input.actorUserId, receiptId],
          );
          if (input.facts) {
            await client.query(
              `INSERT INTO receipt_intake_facts
               (receipt_id, workspace_id, merchant_key, receipt_date, total_minor, currency, entered_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [
                receiptId,
                input.workspaceId,
                merchantKey(input.facts.merchant),
                input.facts.date,
                input.facts.totalMinor,
                input.facts.currency,
                input.actorUserId,
              ],
            );
          }
          created = true;
        }
        await client.query(
          "INSERT INTO receipt_intake_requests (workspace_id, actor_user_id, idempotency_key, source_fingerprint, receipt_id) VALUES ($1,$2,$3,$4,$5)",
          [
            input.workspaceId,
            input.actorUserId,
            input.idempotencyKey,
            fingerprint,
            receiptId,
          ],
        );
      }
      const receipt = await this.getWithClient(
        client,
        input.workspaceId,
        receiptId,
      );
      await client.query("COMMIT");
      return { receipt, created };
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint" in error &&
        error.constraint === "receipt_sources_workspace_id_source_file_id_key"
      ) {
        throw new DomainError(
          "SOURCE_ALREADY_GROUPED",
          409,
          "A source is already part of another receipt.",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async get(
    workspaceId: string,
    actorUserId: string,
    receiptId: string,
  ): Promise<StagedReceipt> {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorUserId, "read");
      return await this.getWithClient(client, workspaceId, receiptId);
    } finally {
      client.release();
    }
  }

  private async authorize(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    permission: "read" | "edit",
  ) {
    const role = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorUserId],
    );
    requireWorkspacePermission(role.rows[0]?.role ?? null, permission);
  }

  private async getWithClient(
    client: PoolClient,
    workspaceId: string,
    receiptId: string,
  ): Promise<StagedReceipt> {
    const result = await client.query<ReceiptRow>(
      `SELECT id, workspace_id AS "workspaceId", status, created_at AS "createdAt" FROM receipts WHERE id = $1 AND workspace_id = $2`,
      [receiptId, workspaceId],
    );
    if (!result.rows[0])
      throw new DomainError("RECEIPT_NOT_FOUND", 404, "Receipt not found.");
    const sources = await client.query<{ sourceFileId: string }>(
      `SELECT source_file_id AS "sourceFileId" FROM receipt_sources WHERE receipt_id = $1 AND workspace_id = $2 ORDER BY position`,
      [receiptId, workspaceId],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      status: row.status,
      sourceIds: sources.rows.map((source) => source.sourceFileId),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
