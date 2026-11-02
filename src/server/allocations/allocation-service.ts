import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { ReviewFields } from "@/server/review/fields";

export type AllocationInput = {
  categoryId: string;
  lineIndexes: number[];
  overrideAmountMinor?: number;
  reason?: string;
};
export type Allocation = {
  id?: string;
  categoryId: string;
  lineIndexes: number[];
  calculatedMinor: number;
  amountMinor: number;
  reason: string | null;
  kind: "selected" | "remainder";
  reviewVersion: number;
};

export function calculateAllocations(
  fields: ReviewFields,
  reviewVersion: number,
  primaryCategoryId: string,
  groups: AllocationInput[],
): Allocation[] {
  if (fields.totalMinor === null)
    throw new DomainError("TOTAL_REQUIRED", 409, "Purchase total is required.");
  const seen = new Set<number>();
  const rows: Allocation[] = [];
  let calculated = BigInt(0);
  let assigned = BigInt(0);
  for (const group of groups) {
    if (!group.lineIndexes.length)
      throw new DomainError(
        "ALLOCATION_EMPTY",
        400,
        "Select at least one line.",
      );
    let groupCalculated = BigInt(0);
    for (const index of group.lineIndexes) {
      if (!Number.isInteger(index) || index < 0 || seen.has(index))
        throw new DomainError(
          "ALLOCATION_LINE_INVALID",
          400,
          "Line selection is invalid or repeated.",
        );
      const line = fields.lineItems[index];
      if (!line)
        throw new DomainError(
          "ALLOCATION_LINE_INVALID",
          400,
          "Line selection is invalid or repeated.",
        );
      if (line.lineTotalMinor === null)
        throw new DomainError(
          "ALLOCATION_LINE_AMOUNT_MISSING",
          409,
          "Selected line has no amount.",
        );
      seen.add(index);
      groupCalculated += BigInt(line.lineTotalMinor);
    }
    const amount = group.overrideAmountMinor ?? Number(groupCalculated);
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new DomainError(
        "ALLOCATION_AMOUNT_INVALID",
        400,
        "Allocation amount is invalid.",
      );
    if (
      BigInt(amount) !== groupCalculated &&
      (!group.reason || group.reason.trim().length < 3)
    )
      throw new DomainError(
        "ALLOCATION_REASON_REQUIRED",
        400,
        "Manual amount changes need a reason.",
      );
    calculated += groupCalculated;
    assigned += BigInt(amount);
    rows.push({
      categoryId: group.categoryId,
      lineIndexes: group.lineIndexes,
      calculatedMinor: Number(groupCalculated),
      amountMinor: amount,
      reason: BigInt(amount) === groupCalculated ? null : group.reason!.trim(),
      kind: "selected",
      reviewVersion,
    });
  }
  const total = BigInt(fields.totalMinor);
  if (assigned > total || calculated > total)
    throw new DomainError(
      "ALLOCATION_EXCEEDS_TOTAL",
      409,
      "Selected amounts exceed the purchase total.",
    );
  const remainder = total - assigned;
  if (remainder > BigInt(0) || rows.length === 0)
    rows.push({
      categoryId: primaryCategoryId,
      lineIndexes: [],
      calculatedMinor: Number(total - calculated),
      amountMinor: Number(remainder),
      reason: null,
      kind: "remainder",
      reviewVersion,
    });
  return rows;
}

export class AllocationService {
  constructor(private readonly pool: Pool) {}
  private async authorize(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
    permission: "read" | "edit",
  ) {
    const result = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorId],
    );
    requireWorkspacePermission(result.rows[0]?.role ?? null, permission);
  }
  private async purchase(
    client: PoolClient,
    workspaceId: string,
    purchaseId: string,
    lock = false,
  ) {
    const result = await client.query<{
      fields: ReviewFields;
      reviewVersion: number;
    }>(
      `SELECT fields, review_version AS "reviewVersion" FROM approved_purchases
       WHERE workspace_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`,
      [workspaceId, purchaseId],
    );
    if (!result.rows[0])
      throw new DomainError(
        "PURCHASE_NOT_FOUND",
        404,
        "Approved purchase not found.",
      );
    return result.rows[0];
  }
  private async rows(
    client: PoolClient,
    workspaceId: string,
    purchaseId: string,
  ): Promise<Allocation[]> {
    const result = await client.query<Allocation>(
      `SELECT id, category_id AS "categoryId", line_indexes AS "lineIndexes",
      calculated_minor::text AS "calculatedMinor", amount_minor::text AS "amountMinor", reason, kind,
      review_version AS "reviewVersion" FROM purchase_allocations
      WHERE workspace_id = $1 AND purchase_id = $2 ORDER BY kind, created_at, id`,
      [workspaceId, purchaseId],
    );
    return result.rows.map((row) => ({
      ...row,
      calculatedMinor: Number(row.calculatedMinor),
      amountMinor: Number(row.amountMinor),
    }));
  }
  async read(workspaceId: string, actorId: string, purchaseId: string) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorId, "read");
      const purchase = await this.purchase(client, workspaceId, purchaseId);
      const allocations = await this.rows(client, workspaceId, purchaseId);
      return {
        allocations,
        reviewVersion: purchase.reviewVersion,
        stale: allocations.some(
          (row) => row.reviewVersion !== purchase.reviewVersion,
        ),
        totalMinor: purchase.fields.totalMinor,
        taxMinor: purchase.fields.taxMinor,
        taxUnknown: purchase.fields.taxUnknown,
        lineItems: purchase.fields.lineItems,
      };
    } finally {
      client.release();
    }
  }
  async replace(input: {
    workspaceId: string;
    actorId: string;
    purchaseId: string;
    key: string;
    expectedReviewVersion: number;
    primaryCategoryId: string;
    groups: AllocationInput[];
  }) {
    const { workspaceId, actorId, purchaseId } = input;
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          purchaseId,
          expectedReviewVersion: input.expectedReviewVersion,
          primaryCategoryId: input.primaryCategoryId,
          groups: input.groups,
        }),
      )
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.authorize(client, workspaceId, actorId, "edit");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`allocations:${workspaceId}:${purchaseId}`],
      );
      const prior = await client.query<{
        payloadHash: string;
        revisionId: string;
      }>(
        `SELECT payload_hash AS "payloadHash", revision_id AS "revisionId" FROM allocation_requests
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
        return { revisionId: prior.rows[0].revisionId };
      }
      const purchase = await this.purchase(
        client,
        workspaceId,
        purchaseId,
        true,
      );
      if (purchase.reviewVersion !== input.expectedReviewVersion)
        throw new DomainError(
          "PURCHASE_VERSION_CONFLICT",
          409,
          "Purchase changed. Reload allocations.",
        );
      const categoryIds = [
        ...new Set([
          input.primaryCategoryId,
          ...input.groups.map((group) => group.categoryId),
        ]),
      ];
      const categories = await client.query<{ id: string }>(
        `SELECT id FROM categories WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
        [workspaceId, categoryIds],
      );
      if (categories.rows.length !== categoryIds.length)
        throw new DomainError(
          "CATEGORY_NOT_FOUND",
          404,
          "Active category not found.",
        );
      const next = calculateAllocations(
        purchase.fields,
        purchase.reviewVersion,
        input.primaryCategoryId,
        input.groups,
      );
      const before = await this.rows(client, workspaceId, purchaseId);
      await client.query(
        "DELETE FROM purchase_allocations WHERE workspace_id = $1 AND purchase_id = $2",
        [workspaceId, purchaseId],
      );
      for (const row of next)
        await client.query(
          `INSERT INTO purchase_allocations
        (id, workspace_id, purchase_id, category_id, line_indexes, calculated_minor, amount_minor, reason, kind, review_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            workspaceId,
            purchaseId,
            row.categoryId,
            JSON.stringify(row.lineIndexes),
            row.calculatedMinor,
            row.amountMinor,
            row.reason,
            row.kind,
            row.reviewVersion,
          ],
        );
      const revisionId = randomUUID();
      await client.query(
        `INSERT INTO allocation_revisions (id, workspace_id, purchase_id, actor_user_id, before_allocations,
        after_allocations, review_version) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          revisionId,
          workspaceId,
          purchaseId,
          actorId,
          JSON.stringify(before),
          JSON.stringify(next),
          purchase.reviewVersion,
        ],
      );
      await client.query(
        `INSERT INTO allocation_requests (workspace_id, actor_user_id, idempotency_key, payload_hash, revision_id)
        VALUES ($1,$2,$3,$4,$5)`,
        [workspaceId, actorId, input.key, hash, revisionId],
      );
      await client.query("COMMIT");
      return { revisionId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
