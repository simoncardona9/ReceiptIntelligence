import { createHash, randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { ReviewFields } from "@/server/review/fields";
import { evaluateReview } from "@/server/review/validation";
import { buildNeutralExport, type ExportPurchase } from "./neutral";

type Selection = { purchaseIds: string[]; mode: "full" | "correction" };
type Candidate = {
  purchase: ExportPurchase;
  previousBatchId: string | null;
  previousVersion: number | null;
};

export class ExportService {
  constructor(private readonly pool: Pool) {}

  private async authorize(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
  ) {
    const roles = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorId],
    );
    requireWorkspacePermission(roles.rows[0]?.role ?? null, "edit");
  }

  private async candidates(
    client: PoolClient,
    workspaceId: string,
    selection: Selection,
  ) {
    const unique = [...new Set(selection.purchaseIds)];
    if (!unique.length || unique.length !== selection.purchaseIds.length)
      throw new DomainError(
        "EXPORT_SELECTION_INVALID",
        400,
        "Select distinct purchases.",
      );
    const rows = await client.query<{
      id: string;
      origin: "receipt" | "manual";
      originId: string;
      reviewVersion: number;
      fields: ReviewFields;
      archivedAt: Date | null;
      previousBatchId: string | null;
      previousVersion: number | null;
    }>(
      `SELECT p.id, p.origin, p.origin_id AS "originId", p.review_version AS "reviewVersion",
        p.fields, p.archived_at AS "archivedAt", previous.batch_id AS "previousBatchId",
        previous.review_version AS "previousVersion"
       FROM approved_purchases p
       LEFT JOIN LATERAL (SELECT e.batch_id, e.review_version FROM export_batch_records e
         JOIN export_batches b ON b.id = e.batch_id
         WHERE e.workspace_id = p.workspace_id AND e.purchase_id = p.id
         ORDER BY b.created_at DESC, b.id DESC LIMIT 1) previous ON true
       WHERE p.workspace_id = $1 AND p.id = ANY($2::uuid[]) FOR SHARE OF p`,
      [workspaceId, unique],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    const blocked: { purchaseId: string; reasons: string[] }[] = [];
    const valid: Candidate[] = [];
    for (const id of unique) {
      const row = byId.get(id);
      if (!row) {
        blocked.push({ purchaseId: id, reasons: ["PURCHASE_NOT_FOUND"] });
        continue;
      }
      const reasons: string[] = [];
      if (row.archivedAt) reasons.push("ARCHIVED");
      if (selection.mode === "correction" && row.previousVersion === null)
        reasons.push("NO_PRIOR_EXPORT");
      if (
        selection.mode === "correction" &&
        row.previousVersion === row.reviewVersion
      )
        reasons.push("NO_NEW_REVISION");
      reasons.push(
        ...evaluateReview({
          current: row.fields,
          original: row.fields,
          proposal: null,
          confirmedFields: [],
        })
          .warnings.filter((w) => w.blocksExport)
          .map((w) => w.code),
      );
      for (const [name, value] of Object.entries({
        date: row.fields.date,
        currency: row.fields.currency,
        subtotal: row.fields.subtotalMinor,
        tax: row.fields.taxMinor,
        paymentMethod: row.fields.paymentMethod,
      }))
        if (value === null) reasons.push(`MISSING_${name.toUpperCase()}`);
      if (reasons.length) {
        blocked.push({ purchaseId: id, reasons });
        continue;
      }
      const products = await client.query<{
        lineIndex: number;
        productId: string;
        productName: string;
        brand: string | null;
      }>(
        `SELECT l.line_index AS "lineIndex", l.product_id AS "productId", p.name AS "productName", p.brand
         FROM purchase_line_products l JOIN products p ON p.id = l.product_id AND p.workspace_id = l.workspace_id
         WHERE l.workspace_id = $1 AND l.purchase_id = $2 AND l.review_version = $3`,
        [workspaceId, id, row.reviewVersion],
      );
      valid.push({
        purchase: {
          id,
          origin: row.origin,
          originId: row.originId,
          reviewVersion: row.reviewVersion,
          fields: row.fields,
          products: products.rows,
        },
        previousBatchId: row.previousBatchId,
        previousVersion: row.previousVersion,
      });
    }
    return { valid, blocked };
  }

  async preview(workspaceId: string, actorId: string, selection: Selection) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorId);
      const { valid, blocked } = await this.candidates(
        client,
        workspaceId,
        selection,
      );
      return {
        ready: valid.map((item) => ({
          purchaseId: item.purchase.id,
          reviewVersion: item.purchase.reviewVersion,
          supersedesBatchId: item.previousBatchId,
        })),
        blocked,
      };
    } finally {
      client.release();
    }
  }

  async create(
    workspaceId: string,
    actorId: string,
    key: string,
    selection: Selection,
  ) {
    const hash = createHash("sha256")
      .update(JSON.stringify(selection))
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.authorize(client, workspaceId, actorId);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`export:${workspaceId}:${actorId}:${key}`],
      );
      const prior = await client.query<{ id: string; requestHash: string }>(
        `SELECT id, request_hash AS "requestHash" FROM export_batches
         WHERE workspace_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
        [workspaceId, actorId, key],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].requestHash !== hash)
          throw new DomainError(
            "IDEMPOTENCY_KEY_REUSED",
            409,
            "Request key was reused with different content.",
          );
        await client.query("COMMIT");
        return { exportId: prior.rows[0].id, repeated: true };
      }
      const { valid, blocked } = await this.candidates(
        client,
        workspaceId,
        selection,
      );
      if (!valid.length)
        throw new DomainError(
          "EXPORT_NONE_READY",
          409,
          "No selected purchases are exportable.",
        );
      const exportId = randomUUID();
      const payload = buildNeutralExport({
        exportId,
        createdAt: new Date().toISOString(),
        purchases: valid.map((item) => item.purchase),
      });
      const archive = zipSync(
        {
          "manifest.json": strToU8(JSON.stringify(payload.manifest) + "\n"),
          "purchases.json": strToU8(payload.json),
          "receipts.csv": strToU8(payload.receiptsCsv),
          "lines.csv": strToU8(payload.linesCsv),
        },
        { level: 6 },
      );
      await client.query(
        `INSERT INTO export_batches (id, workspace_id, actor_user_id, idempotency_key,
          request_hash, mode, manifest, zip_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          exportId,
          workspaceId,
          actorId,
          key,
          hash,
          selection.mode,
          payload.manifest,
          Buffer.from(archive),
        ],
      );
      for (const item of valid)
        await client.query(
          `INSERT INTO export_batch_records (batch_id, workspace_id, purchase_id, review_version, supersedes_batch_id)
         VALUES ($1,$2,$3,$4,$5)`,
          [
            exportId,
            workspaceId,
            item.purchase.id,
            item.purchase.reviewVersion,
            item.previousBatchId,
          ],
        );
      await client.query("COMMIT");
      return {
        exportId,
        repeated: false,
        blocked,
        exportedIds: valid.map((item) => item.purchase.id),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async history(workspaceId: string, actorId: string) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorId);
      const rows = await client.query(
        `SELECT b.id, b.mode, b.created_at AS "createdAt", b.manifest,
          json_agg(json_build_object('purchaseId', r.purchase_id,
          'reviewVersion', r.review_version, 'supersedesBatchId', r.supersedes_batch_id)
          ORDER BY r.purchase_id) AS records
         FROM export_batches b JOIN export_batch_records r ON r.batch_id = b.id
         WHERE b.workspace_id = $1 GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`,
        [workspaceId],
      );
      return rows.rows;
    } finally {
      client.release();
    }
  }

  async download(workspaceId: string, actorId: string, exportId: string) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorId);
      const row = await client.query<{ zipBytes: Buffer }>(
        `SELECT zip_bytes AS "zipBytes" FROM export_batches WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, exportId],
      );
      if (!row.rows[0])
        throw new DomainError("EXPORT_NOT_FOUND", 404, "Export not found.");
      await client.query(
        `INSERT INTO export_download_events (id, workspace_id, actor_user_id, batch_id)
        VALUES ($1,$2,$3,$4)`,
        [randomUUID(), workspaceId, actorId, exportId],
      );
      return row.rows[0].zipBytes;
    } finally {
      client.release();
    }
  }
}
