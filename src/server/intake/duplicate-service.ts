import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";

export type DuplicateDecision = "same" | "different";

export class DuplicateService {
  constructor(private readonly pool: Pool) {}

  async suggestions(
    workspaceId: string,
    actorUserId: string,
    receiptId: string,
  ) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorUserId, "read");
      await this.requireReceipt(client, workspaceId, receiptId);
      const result = await client.query<{
        id: string;
        decision: DuplicateDecision | null;
      }>(
        `SELECT r.id, d.decision FROM receipt_intake_facts origin
         JOIN receipt_intake_facts candidate
           ON candidate.workspace_id = origin.workspace_id
          AND candidate.merchant_key = origin.merchant_key
          AND candidate.receipt_date = origin.receipt_date
          AND candidate.total_minor = origin.total_minor
          AND candidate.currency = origin.currency
          AND candidate.receipt_id <> origin.receipt_id
         JOIN receipts r ON r.id = candidate.receipt_id AND r.workspace_id = $1
         LEFT JOIN receipt_duplicate_decisions d
           ON d.workspace_id = $1 AND d.receipt_id = LEAST($2::uuid, r.id)
          AND d.candidate_id = GREATEST($2::uuid, r.id)
         WHERE origin.receipt_id = $2 AND origin.workspace_id = $1
         ORDER BY r.created_at, r.id LIMIT 50`,
        [workspaceId, receiptId],
      );
      return result.rows.map((row) => ({
        receiptId: row.id,
        decision: row.decision,
      }));
    } finally {
      client.release();
    }
  }

  async decide(input: {
    workspaceId: string;
    actorUserId: string;
    receiptId: string;
    candidateId: string;
    decision: DuplicateDecision;
  }) {
    if (input.receiptId === input.candidateId)
      throw new DomainError(
        "INVALID_DUPLICATE_PAIR",
        400,
        "Choose a different receipt.",
      );
    const [first, second] = [input.receiptId, input.candidateId].sort();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.authorize(
        client,
        input.workspaceId,
        input.actorUserId,
        "edit",
      );
      await this.requireReceipt(client, input.workspaceId, first);
      await this.requireReceipt(client, input.workspaceId, second);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`duplicate:${input.workspaceId}:${first}:${second}`],
      );
      const match = await client.query(
        `SELECT 1 FROM receipt_intake_facts a JOIN receipt_intake_facts b
          ON a.workspace_id = b.workspace_id AND a.merchant_key = b.merchant_key
         AND a.receipt_date = b.receipt_date AND a.total_minor = b.total_minor
         AND a.currency = b.currency
         WHERE a.workspace_id = $1 AND a.receipt_id = $2 AND b.receipt_id = $3`,
        [input.workspaceId, first, second],
      );
      if (!match.rowCount)
        throw new DomainError(
          "DUPLICATE_SUGGESTION_NOT_FOUND",
          404,
          "Duplicate suggestion not found.",
        );
      const prior = await client.query<{ decision: DuplicateDecision }>(
        "SELECT decision FROM receipt_duplicate_decisions WHERE workspace_id = $1 AND receipt_id = $2 AND candidate_id = $3",
        [input.workspaceId, first, second],
      );
      if (prior.rows[0] && prior.rows[0].decision !== input.decision)
        throw new DomainError(
          "DUPLICATE_DECISION_CONFLICT",
          409,
          "This pair was already decided.",
        );
      if (!prior.rows[0]) {
        await client.query(
          "INSERT INTO receipt_duplicate_decisions (workspace_id, receipt_id, candidate_id, decision, decided_by) VALUES ($1,$2,$3,$4,$5)",
          [input.workspaceId, first, second, input.decision, input.actorUserId],
        );
        await client.query(
          "INSERT INTO receipt_duplicate_audit_events (id, workspace_id, actor_user_id, receipt_id, candidate_id, decision) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            input.workspaceId,
            input.actorUserId,
            first,
            second,
            input.decision,
          ],
        );
      }
      await client.query("COMMIT");
      return {
        receiptId: first,
        candidateId: second,
        decision: input.decision,
        created: !prior.rows[0],
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
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

  private async requireReceipt(
    client: PoolClient,
    workspaceId: string,
    receiptId: string,
  ) {
    const result = await client.query(
      "SELECT 1 FROM receipts WHERE workspace_id = $1 AND id = $2",
      [workspaceId, receiptId],
    );
    if (!result.rowCount)
      throw new DomainError("RECEIPT_NOT_FOUND", 404, "Receipt not found.");
  }
}
