import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { ReviewFields } from "@/server/review/fields";
import { categoryKey } from "@/server/catalog/category-service";

export type ApprovedSummary = {
  id: string;
  origin: "receipt" | "manual";
  originId: string;
  merchant: string | null;
  totalMinor: number | null;
  currency: string | null;
  approvedAt: string;
  archivedAt: string | null;
  reviewVersion: number;
};

export class ApprovedRecordService {
  constructor(private readonly pool: Pool) {}
  private async role(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
  ): Promise<WorkspaceRole> {
    const result = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorId],
    );
    const role = result.rows[0]?.role ?? null;
    requireWorkspacePermission(role, "read");
    return role!;
  }
  async list(
    workspaceId: string,
    actorId: string,
    query: string,
    includeArchived: boolean,
  ) {
    const client = await this.pool.connect();
    try {
      const role = await this.role(client, workspaceId, actorId);
      if (includeArchived && role !== "owner")
        throw new DomainError(
          "OWNER_REQUIRED",
          403,
          "Only the owner can view archived records.",
        );
      const search = query.trim().toLocaleLowerCase("es-UY").slice(0, 160);
      const productKey = categoryKey(query).slice(0, 160);
      const result = await client.query<{
        id: string;
        origin: "receipt" | "manual";
        originId: string;
        fields: ReviewFields;
        approvedAt: Date;
        archivedAt: Date | null;
        reviewVersion: number;
      }>(
        `SELECT p.id, p.origin, p.origin_id AS "originId", p.fields,
          p.approved_at AS "approvedAt", p.archived_at AS "archivedAt", p.review_version AS "reviewVersion"
        FROM approved_purchases p WHERE p.workspace_id = $1
        AND ($2::boolean OR p.archived_at IS NULL)
        AND ($3::text = '' OR strpos(lower(COALESCE(p.fields->>'merchant','')), $3) > 0
          OR strpos(p.id::text, $3) > 0 OR strpos(p.origin_id::text, $3) > 0
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.fields->'lineItems','[]'::jsonb)) line
            WHERE strpos(lower(COALESCE(line->>'description','')), $3) > 0)
          OR EXISTS (SELECT 1 FROM purchase_line_products link JOIN products product
            ON product.id = link.product_id AND product.workspace_id = link.workspace_id
            WHERE link.workspace_id = p.workspace_id AND link.purchase_id = p.id
            AND link.review_version = p.review_version AND strpos(product.name_key, $4) > 0))
        ORDER BY p.approved_at DESC, p.id DESC LIMIT 100`,
        [workspaceId, includeArchived, search, productKey],
      );
      return result.rows.map((row): ApprovedSummary => ({
        id: row.id,
        origin: row.origin,
        originId: row.originId,
        merchant: row.fields.merchant,
        totalMinor: row.fields.totalMinor,
        currency: row.fields.currency,
        approvedAt: row.approvedAt.toISOString(),
        archivedAt: row.archivedAt?.toISOString() ?? null,
        reviewVersion: row.reviewVersion,
      }));
    } finally {
      client.release();
    }
  }
  async detail(workspaceId: string, actorId: string, purchaseId: string) {
    const client = await this.pool.connect();
    try {
      const role = await this.role(client, workspaceId, actorId);
      const result = await client.query<{
        id: string;
        origin: "receipt" | "manual";
        originId: string;
        reviewId: string;
        fields: ReviewFields;
        reviewVersion: number;
        approvedAt: Date;
        archivedAt: Date | null;
        approvalMode: string;
        approvedBy: string;
      }>(
        `SELECT id, origin, origin_id AS "originId", review_id AS "reviewId", fields,
        review_version AS "reviewVersion", approved_at AS "approvedAt", archived_at AS "archivedAt",
        approval_mode AS "approvalMode", approved_by AS "approvedBy"
        FROM approved_purchases WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, purchaseId],
      );
      const row = result.rows[0];
      if (!row || (row.archivedAt && role !== "owner"))
        throw new DomainError(
          "PURCHASE_NOT_FOUND",
          404,
          "Approved purchase not found.",
        );
      const sources =
        row.origin === "receipt"
          ? await client.query<{
              id: string;
              filename: string;
              removedAt: Date | null;
              position: number;
            }>(
              `SELECT s.id, s.original_filename AS filename, s.removed_at AS "removedAt", rs.position
         FROM receipt_sources rs JOIN source_files s ON s.id = rs.source_file_id AND s.workspace_id = rs.workspace_id
         WHERE rs.workspace_id = $1 AND rs.receipt_id = $2 ORDER BY rs.position`,
              [workspaceId, row.originId],
            )
          : null;
      const allocations = await client.query<{
        categoryId: string;
        categoryName: string;
        amountMinor: string;
        lineIndexes: number[];
        kind: string;
        reviewVersion: number;
      }>(
        `SELECT a.category_id AS "categoryId", c.name AS "categoryName",
        a.amount_minor::text AS "amountMinor", a.line_indexes AS "lineIndexes", a.kind,
        a.review_version AS "reviewVersion" FROM purchase_allocations a JOIN categories c
        ON c.id = a.category_id AND c.workspace_id = a.workspace_id WHERE a.workspace_id = $1 AND a.purchase_id = $2
        ORDER BY a.kind, a.created_at, a.id`,
        [workspaceId, purchaseId],
      );
      const products = await client.query<{
        lineIndex: number;
        productId: string;
        productName: string;
        brand: string | null;
        sourceDescription: string;
        reviewVersion: number;
      }>(
        `SELECT l.line_index AS "lineIndex", l.product_id AS "productId",
        p.name AS "productName", p.brand, l.source_description AS "sourceDescription",
        l.review_version AS "reviewVersion" FROM purchase_line_products l JOIN products p
        ON p.id = l.product_id AND p.workspace_id = l.workspace_id WHERE l.workspace_id = $1 AND l.purchase_id = $2`,
        [workspaceId, purchaseId],
      );
      return {
        ...row,
        approvedAt: row.approvedAt.toISOString(),
        archivedAt: row.archivedAt?.toISOString() ?? null,
        role,
        sources:
          sources?.rows.map((source) => ({
            ...source,
            removedAt: source.removedAt?.toISOString() ?? null,
          })) ?? [],
        allocations: allocations.rows.map((allocation) => ({
          ...allocation,
          amountMinor: Number(allocation.amountMinor),
          stale: allocation.reviewVersion !== row.reviewVersion,
        })),
        products: products.rows.filter(
          (product) =>
            product.reviewVersion === row.reviewVersion &&
            row.fields.lineItems[product.lineIndex]?.description ===
              product.sourceDescription,
        ),
      };
    } finally {
      client.release();
    }
  }
  async archive(input: {
    workspaceId: string;
    actorId: string;
    purchaseId: string;
    key: string;
    action: "archive" | "restore";
    expectedArchived: boolean;
  }) {
    const { workspaceId, actorId, purchaseId } = input;
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          purchaseId,
          action: input.action,
          expectedArchived: input.expectedArchived,
        }),
      )
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const role = await this.role(client, workspaceId, actorId);
      if (role !== "owner")
        throw new DomainError(
          "OWNER_REQUIRED",
          403,
          "Only the owner can archive or restore records.",
        );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`approved-record:${workspaceId}:${purchaseId}`],
      );
      const prior = await client.query<{ payloadHash: string }>(
        `SELECT payload_hash AS "payloadHash" FROM approved_record_requests
        WHERE workspace_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
        [workspaceId, actorId, input.key],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].payloadHash !== hash)
          throw new DomainError(
            "IDEMPOTENCY_KEY_REUSED",
            409,
            "Request key was reused with different content.",
          );
        await client.query("COMMIT");
        return { id: purchaseId };
      }
      const record = await client.query<{ archivedAt: Date | null }>(
        `SELECT archived_at AS "archivedAt" FROM approved_purchases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [workspaceId, purchaseId],
      );
      if (!record.rows[0])
        throw new DomainError(
          "PURCHASE_NOT_FOUND",
          404,
          "Approved purchase not found.",
        );
      if (Boolean(record.rows[0].archivedAt) !== input.expectedArchived)
        throw new DomainError(
          "PURCHASE_ARCHIVE_CONFLICT",
          409,
          "Record state changed. Reload before saving.",
        );
      if ((input.action === "archive") === input.expectedArchived)
        throw new DomainError(
          "PURCHASE_ARCHIVE_CONFLICT",
          409,
          "Record is already in the requested state.",
        );
      await client.query(
        `UPDATE approved_purchases SET archived_at = ${input.action === "archive" ? "now()" : "NULL"},
        archived_by = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, purchaseId, input.action === "archive" ? actorId : null],
      );
      await client.query(
        `INSERT INTO approved_record_events (id, workspace_id, actor_user_id, purchase_id, action)
        VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), workspaceId, actorId, purchaseId, input.action],
      );
      await client.query(
        `INSERT INTO approved_record_requests (workspace_id, actor_user_id, idempotency_key, payload_hash, purchase_id, action)
        VALUES ($1,$2,$3,$4,$5,$6)`,
        [workspaceId, actorId, input.key, hash, purchaseId, input.action],
      );
      await client.query("COMMIT");
      return { id: purchaseId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
