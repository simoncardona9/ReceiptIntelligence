import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";

export type ManualLine = {
  description: string;
  quantityMilli: number;
  totalMinor: number;
};
export type ManualFields = {
  merchant: string;
  date: string;
  totalMinor: number;
  currency: "UYU" | "USD";
  categoryName?: string;
  lines?: ManualLine[];
};
export type ManualExpense = ManualFields & {
  id: string;
  workspaceId: string;
  origin: "manual";
  status: "staged";
  createdAt: string;
  lines: ManualLine[];
};

export class ManualService {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    fields: ManualFields;
  }): Promise<{ expense: ManualExpense; created: boolean }> {
    const hash = createHash("sha256")
      .update(JSON.stringify(input.fields))
      .digest("hex");
    const client = await this.pool.connect();
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
        [
          `manual:${input.workspaceId}:${input.actorUserId}:${input.idempotencyKey}`,
        ],
      );
      const prior = await client.query<{
        payloadHash: string;
        expenseId: string;
      }>(
        `SELECT payload_hash AS "payloadHash", expense_id AS "expenseId" FROM manual_expense_requests
         WHERE workspace_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
        [input.workspaceId, input.actorUserId, input.idempotencyKey],
      );
      if (prior.rows[0] && prior.rows[0].payloadHash !== hash)
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "This request key was already used for different content.",
        );
      let expenseId = prior.rows[0]?.expenseId;
      const created = !expenseId;
      if (!expenseId) {
        expenseId = randomUUID();
        await client.query(
          `INSERT INTO manual_expenses
           (id, workspace_id, merchant, expense_date, total_minor, currency, category_name, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            expenseId,
            input.workspaceId,
            input.fields.merchant,
            input.fields.date,
            input.fields.totalMinor,
            input.fields.currency,
            input.fields.categoryName ?? null,
            input.actorUserId,
          ],
        );
        for (const [position, line] of (input.fields.lines ?? []).entries()) {
          await client.query(
            `INSERT INTO manual_expense_lines (id, expense_id, workspace_id, position, description, quantity_milli, total_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              randomUUID(),
              expenseId,
              input.workspaceId,
              position,
              line.description,
              line.quantityMilli,
              line.totalMinor,
            ],
          );
        }
        await client.query(
          "INSERT INTO manual_expense_requests (workspace_id, actor_user_id, idempotency_key, payload_hash, expense_id) VALUES ($1,$2,$3,$4,$5)",
          [
            input.workspaceId,
            input.actorUserId,
            input.idempotencyKey,
            hash,
            expenseId,
          ],
        );
        await client.query(
          "INSERT INTO manual_expense_audit_events (id, workspace_id, actor_user_id, expense_id, action) VALUES ($1,$2,$3,$4,'manual_expense_staged')",
          [randomUUID(), input.workspaceId, input.actorUserId, expenseId],
        );
      }
      const expense = await this.getWithClient(
        client,
        input.workspaceId,
        expenseId,
      );
      await client.query("COMMIT");
      return { expense, created };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(
    workspaceId: string,
    actorUserId: string,
    expenseId: string,
  ): Promise<ManualExpense> {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorUserId, "read");
      return await this.getWithClient(client, workspaceId, expenseId);
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
    const membership = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorUserId],
    );
    requireWorkspacePermission(membership.rows[0]?.role ?? null, permission);
  }

  private async getWithClient(
    client: PoolClient,
    workspaceId: string,
    expenseId: string,
  ): Promise<ManualExpense> {
    const result = await client.query<{
      id: string;
      workspaceId: string;
      merchant: string;
      date: string;
      totalMinor: string;
      currency: "UYU" | "USD";
      categoryName: string | null;
      createdAt: Date;
    }>(
      `SELECT id, workspace_id AS "workspaceId", merchant, expense_date::text AS date,
         total_minor AS "totalMinor", currency, category_name AS "categoryName", created_at AS "createdAt"
       FROM manual_expenses WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, expenseId],
    );
    if (!result.rows[0])
      throw new DomainError(
        "MANUAL_EXPENSE_NOT_FOUND",
        404,
        "Manual expense not found.",
      );
    const row = result.rows[0];
    const lines = await client.query<{
      description: string;
      quantityMilli: string;
      totalMinor: string;
    }>(
      `SELECT description, quantity_milli AS "quantityMilli", total_minor AS "totalMinor"
       FROM manual_expense_lines WHERE workspace_id = $1 AND expense_id = $2 ORDER BY position`,
      [workspaceId, expenseId],
    );
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      origin: "manual",
      status: "staged",
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
      createdAt: row.createdAt.toISOString(),
    };
  }
}
