import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { Proposal } from "@/server/extraction/normalization";
import {
  fieldsFromManual,
  fieldsFromProposal,
  type ReviewFields,
} from "./fields";

export type ReviewOrigin = "receipt" | "manual";
export type ReviewRevision = {
  version: number;
  before: ReviewFields;
  after: ReviewFields;
  reason: string;
  actorUserId: string;
  createdAt: string;
};
export type ReviewRecord = {
  id: string | null;
  origin: ReviewOrigin;
  originId: string;
  version: number;
  baseProposalId: string | null;
  original: ReviewFields;
  current: ReviewFields;
  revisions: ReviewRevision[];
};
type StoredRow = {
  id: string;
  fields: ReviewFields;
  version: number;
  baseProposalId: string | null;
};

export class ReviewService {
  constructor(private readonly pool: Pool) {}

  private async authorize(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    permission: "read" | "edit",
  ) {
    const result = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorUserId],
    );
    requireWorkspacePermission(result.rows[0]?.role ?? null, permission);
  }

  private async stored(
    client: PoolClient,
    workspaceId: string,
    origin: ReviewOrigin,
    originId: string,
  ): Promise<StoredRow | null> {
    const result = await client.query<StoredRow>(
      `SELECT id, fields, version, base_proposal_id AS "baseProposalId" FROM review_records
       WHERE workspace_id = $1 AND origin = $2 AND origin_id = $3`,
      [workspaceId, origin, originId],
    );
    return result.rows[0] ?? null;
  }

  private async base(
    client: PoolClient,
    workspaceId: string,
    origin: ReviewOrigin,
    originId: string,
    proposalId: string | null,
  ): Promise<{ fields: ReviewFields; proposalId: string | null }> {
    if (origin === "manual") {
      const result = await client.query<{
        merchant: string;
        date: string;
        totalMinor: string;
        currency: "UYU" | "USD";
        categoryName: string | null;
      }>(
        `SELECT merchant, expense_date::text AS date, total_minor AS "totalMinor", currency, category_name AS "categoryName"
         FROM manual_expenses WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, originId],
      );
      if (!result.rows[0])
        throw new DomainError(
          "MANUAL_EXPENSE_NOT_FOUND",
          404,
          "Manual expense not found.",
        );
      const lines = await client.query<{
        description: string;
        quantityMilli: string;
        totalMinor: string;
      }>(
        `SELECT description, quantity_milli AS "quantityMilli", total_minor AS "totalMinor"
         FROM manual_expense_lines WHERE workspace_id = $1 AND expense_id = $2 ORDER BY position`,
        [workspaceId, originId],
      );
      const row = result.rows[0];
      return {
        fields: fieldsFromManual({
          id: originId,
          workspaceId,
          origin: "manual",
          status: "staged",
          createdAt: "",
          merchant: row.merchant,
          date: row.date,
          totalMinor: Number(row.totalMinor),
          currency: row.currency,
          ...(row.categoryName ? { categoryName: row.categoryName } : {}),
          lines: lines.rows.map((line) => ({
            description: line.description,
            quantityMilli: Number(line.quantityMilli),
            totalMinor: Number(line.totalMinor),
          })),
        }),
        proposalId: null,
      };
    }
    const receipt = await client.query<{ id: string }>(
      "SELECT id FROM receipts WHERE workspace_id = $1 AND id = $2",
      [workspaceId, originId],
    );
    if (!receipt.rows[0])
      throw new DomainError("RECEIPT_NOT_FOUND", 404, "Receipt not found.");
    const result = await client.query<{ id: string; proposal: Proposal }>(
      `SELECT id, proposal FROM receipt_proposals WHERE workspace_id = $1 AND receipt_id = $2
       ${proposalId ? "AND id = $3" : ""} ORDER BY created_at DESC LIMIT 1`,
      proposalId
        ? [workspaceId, originId, proposalId]
        : [workspaceId, originId],
    );
    if (!result.rows[0])
      throw new DomainError("PROPOSAL_NOT_FOUND", 404, "Proposal not found.");
    return {
      fields: fieldsFromProposal(result.rows[0].proposal),
      proposalId: result.rows[0].id,
    };
  }

  private async readWithClient(
    client: PoolClient,
    workspaceId: string,
    origin: ReviewOrigin,
    originId: string,
  ): Promise<ReviewRecord> {
    const stored = await this.stored(client, workspaceId, origin, originId);
    const base = await this.base(
      client,
      workspaceId,
      origin,
      originId,
      stored?.baseProposalId ?? null,
    );
    const revisions = stored
      ? await client.query<{
          version: number;
          before: ReviewFields;
          after: ReviewFields;
          reason: string;
          actorUserId: string;
          createdAt: Date;
        }>(
          `SELECT version, before_fields AS before, after_fields AS after, reason,
       actor_user_id AS "actorUserId", created_at AS "createdAt" FROM review_revisions
       WHERE workspace_id = $1 AND review_id = $2 ORDER BY version`,
          [workspaceId, stored.id],
        )
      : null;
    return {
      id: stored?.id ?? null,
      origin,
      originId,
      version: stored?.version ?? 0,
      baseProposalId: base.proposalId,
      original: base.fields,
      current: stored?.fields ?? base.fields,
      revisions:
        revisions?.rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })) ?? [],
    };
  }

  async read(
    workspaceId: string,
    actorUserId: string,
    origin: ReviewOrigin,
    originId: string,
  ): Promise<ReviewRecord> {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorUserId, "read");
      return await this.readWithClient(client, workspaceId, origin, originId);
    } finally {
      client.release();
    }
  }

  async correct(input: {
    workspaceId: string;
    actorUserId: string;
    origin: ReviewOrigin;
    originId: string;
    expectedVersion: number;
    expectedBaseProposalId: string | null;
    idempotencyKey: string;
    reason: string;
    fields: ReviewFields;
  }): Promise<ReviewRecord> {
    const client = await this.pool.connect();
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          expectedVersion: input.expectedVersion,
          expectedBaseProposalId: input.expectedBaseProposalId,
          reason: input.reason,
          fields: input.fields,
        }),
      )
      .digest("hex");
    try {
      await client.query("BEGIN");
      await this.authorize(
        client,
        input.workspaceId,
        input.actorUserId,
        "edit",
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`review:${input.workspaceId}:${input.origin}:${input.originId}`],
      );
      const stored = await this.stored(
        client,
        input.workspaceId,
        input.origin,
        input.originId,
      );
      const base = await this.base(
        client,
        input.workspaceId,
        input.origin,
        input.originId,
        stored?.baseProposalId ?? null,
      );
      if (stored) {
        const previous = await client.query<{ payloadHash: string }>(
          `SELECT payload_hash AS "payloadHash" FROM review_revisions WHERE review_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
          [stored.id, input.actorUserId, input.idempotencyKey],
        );
        if (previous.rows[0]) {
          if (previous.rows[0].payloadHash !== hash)
            throw new DomainError(
              "IDEMPOTENCY_KEY_REUSED",
              409,
              "Request key was reused with different content.",
            );
          const result = await this.readWithClient(
            client,
            input.workspaceId,
            input.origin,
            input.originId,
          );
          await client.query("COMMIT");
          return result;
        }
      }
      const version = stored?.version ?? 0;
      if (base.proposalId !== input.expectedBaseProposalId)
        throw new DomainError(
          "REVIEW_SOURCE_CHANGED",
          409,
          "Source proposal changed. Reload before saving.",
        );
      if (version !== input.expectedVersion)
        throw new DomainError(
          "REVIEW_VERSION_CONFLICT",
          409,
          "Review changed. Reload before saving.",
        );
      const before = stored?.fields ?? base.fields;
      if (JSON.stringify(before) === JSON.stringify(input.fields))
        throw new DomainError(
          "REVIEW_UNCHANGED",
          400,
          "No correction was provided.",
        );
      const reviewId = stored?.id ?? randomUUID();
      if (stored) {
        await client.query(
          "UPDATE review_records SET fields = $1, version = version + 1, updated_at = now() WHERE id = $2 AND workspace_id = $3",
          [input.fields, reviewId, input.workspaceId],
        );
      } else {
        await client.query(
          `INSERT INTO review_records (id, workspace_id, origin, origin_id, base_proposal_id, fields, version) VALUES ($1,$2,$3,$4,$5,$6,1)`,
          [
            reviewId,
            input.workspaceId,
            input.origin,
            input.originId,
            base.proposalId,
            input.fields,
          ],
        );
      }
      await client.query(
        `INSERT INTO review_revisions (id, review_id, workspace_id, version, before_fields, after_fields, reason, actor_user_id, idempotency_key, payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          reviewId,
          input.workspaceId,
          version + 1,
          before,
          input.fields,
          input.reason,
          input.actorUserId,
          input.idempotencyKey,
          hash,
        ],
      );
      await client.query(
        `INSERT INTO review_audit_events (id, review_id, workspace_id, actor_user_id, action, version) VALUES ($1,$2,$3,$4,'review_corrected',$5)`,
        [
          randomUUID(),
          reviewId,
          input.workspaceId,
          input.actorUserId,
          version + 1,
        ],
      );
      const result = await this.readWithClient(
        client,
        input.workspaceId,
        input.origin,
        input.originId,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
