import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { ReviewFields } from "@/server/review/fields";
import { categoryKey } from "./category-service";

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  nameKey: string;
  brandKey: string | null;
};
export type ProductMatch = {
  product: Product;
  confidence: "high" | "uncertain";
  reason: string;
};

export function rankProduct(
  description: string,
  brand: string | null,
  product: Product,
  aliases: string[],
): ProductMatch | null {
  const key = categoryKey(description);
  const brandKey = brand ? categoryKey(brand) : null;
  const exactAlias = aliases.includes(key);
  const exactName = product.nameKey === key;
  if (!exactAlias && !exactName) return null;
  if (brandKey && product.brandKey && brandKey !== product.brandKey)
    return { product, confidence: "uncertain", reason: "brand_difference" };
  if (product.brandKey && !brandKey)
    return { product, confidence: "uncertain", reason: "brand_unverified" };
  return {
    product,
    confidence: "high",
    reason: exactAlias ? "exact_description" : "exact_name",
  };
}

export class ProductService {
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
  private async products(
    client: PoolClient,
    workspaceId: string,
  ): Promise<Product[]> {
    const result = await client.query<Product>(
      `SELECT id, name, brand, name_key AS "nameKey", brand_key AS "brandKey"
      FROM products WHERE workspace_id = $1 ORDER BY name_key, brand_key, id`,
      [workspaceId],
    );
    return result.rows;
  }
  async list(workspaceId: string, actorId: string) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorId, "read");
      return this.products(client, workspaceId);
    } finally {
      client.release();
    }
  }
  private async matches(
    client: PoolClient,
    workspaceId: string,
    description: string,
    brand: string | null,
  ) {
    const products = await this.products(client, workspaceId);
    const aliases = await client.query<{
      productId: string;
      descriptionKey: string;
    }>(
      `SELECT DISTINCT product_id AS "productId", description_key AS "descriptionKey" FROM purchase_line_products
       WHERE workspace_id = $1`,
      [workspaceId],
    );
    return products
      .map((product) =>
        rankProduct(
          description,
          brand,
          product,
          aliases.rows
            .filter((alias) => alias.productId === product.id)
            .map((alias) => alias.descriptionKey),
        ),
      )
      .filter((match): match is ProductMatch => match !== null)
      .sort(
        (a, b) =>
          (a.confidence === "high" ? -1 : 1) -
          (b.confidence === "high" ? -1 : 1),
      );
  }
  async suggest(
    workspaceId: string,
    actorId: string,
    description: string,
    brand: string | null,
  ) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorId, "read");
      return this.matches(client, workspaceId, description, brand);
    } finally {
      client.release();
    }
  }
  async lines(workspaceId: string, actorId: string, purchaseId: string) {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, workspaceId, actorId, "read");
      const purchase = await client.query<{
        fields: ReviewFields;
        reviewVersion: number;
      }>(
        `SELECT fields, review_version AS "reviewVersion" FROM approved_purchases WHERE id = $1 AND workspace_id = $2`,
        [purchaseId, workspaceId],
      );
      if (!purchase.rows[0])
        throw new DomainError(
          "PURCHASE_NOT_FOUND",
          404,
          "Approved purchase not found.",
        );
      const links = await client.query<{
        lineIndex: number;
        productId: string;
        confidence: string;
        sourceDescription: string;
        reviewVersion: number;
      }>(
        `SELECT line_index AS "lineIndex", product_id AS "productId", confidence,
         source_description AS "sourceDescription", review_version AS "reviewVersion"
         FROM purchase_line_products WHERE workspace_id = $1 AND purchase_id = $2 ORDER BY line_index`,
        [workspaceId, purchaseId],
      );
      const fields = purchase.rows[0].fields;
      return {
        lines: fields.lineItems.map((line, index) => ({
          index,
          description: line.description,
          lineTotalMinor: line.lineTotalMinor,
          link:
            links.rows.find(
              (link) =>
                link.lineIndex === index &&
                link.reviewVersion === purchase.rows[0].reviewVersion &&
                link.sourceDescription === line.description,
            ) ?? null,
        })),
        reviewVersion: purchase.rows[0].reviewVersion,
      };
    } finally {
      client.release();
    }
  }
  async mutate(input: {
    workspaceId: string;
    actorId: string;
    key: string;
    operation:
      | { action: "create"; name: string; brand: string | null }
      | {
          action: "rename";
          productId: string;
          name: string;
          brand: string | null;
        }
      | {
          action: "link";
          purchaseId: string;
          lineIndex: number;
          productId: string;
          brand: string | null;
          confirmUncertain: boolean;
          expectedReviewVersion: number;
        };
  }) {
    const { workspaceId, actorId, operation } = input;
    const hash = createHash("sha256")
      .update(JSON.stringify(operation))
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.authorize(client, workspaceId, actorId, "edit");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`products:${workspaceId}`],
      );
      const prior = await client.query<{
        payloadHash: string;
        resultId: string;
      }>(
        `SELECT payload_hash AS "payloadHash", result_id AS "resultId" FROM product_requests
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
        return { id: prior.rows[0].resultId };
      }
      let resultId: string;
      let purchaseId: string | null = null;
      if (operation.action === "create") {
        const duplicate = await client.query(
          "SELECT id FROM products WHERE workspace_id = $1 AND name_key = $2 AND brand_key IS NOT DISTINCT FROM $3",
          [
            workspaceId,
            categoryKey(operation.name),
            operation.brand ? categoryKey(operation.brand) : null,
          ],
        );
        if (duplicate.rows.length)
          throw new DomainError(
            "PRODUCT_EXISTS",
            409,
            "Product already exists.",
          );
        resultId = randomUUID();
        await client.query(
          `INSERT INTO products (id, workspace_id, name, name_key, brand, brand_key) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            resultId,
            workspaceId,
            operation.name.trim(),
            categoryKey(operation.name),
            operation.brand?.trim() ?? null,
            operation.brand ? categoryKey(operation.brand) : null,
          ],
        );
      } else if (operation.action === "rename") {
        const updated = await client.query(
          `UPDATE products SET name = $3, name_key = $4, brand = $5, brand_key = $6, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 RETURNING id`,
          [
            workspaceId,
            operation.productId,
            operation.name.trim(),
            categoryKey(operation.name),
            operation.brand?.trim() ?? null,
            operation.brand ? categoryKey(operation.brand) : null,
          ],
        );
        if (!updated.rows.length)
          throw new DomainError("PRODUCT_NOT_FOUND", 404, "Product not found.");
        resultId = operation.productId;
      } else {
        purchaseId = operation.purchaseId;
        const purchase = await client.query<{
          fields: ReviewFields;
          reviewVersion: number;
        }>(
          `SELECT fields, review_version AS "reviewVersion" FROM approved_purchases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [workspaceId, purchaseId],
        );
        if (!purchase.rows[0])
          throw new DomainError(
            "PURCHASE_NOT_FOUND",
            404,
            "Approved purchase not found.",
          );
        if (purchase.rows[0].reviewVersion !== operation.expectedReviewVersion)
          throw new DomainError(
            "PURCHASE_VERSION_CONFLICT",
            409,
            "Purchase changed. Reload before linking.",
          );
        const line = purchase.rows[0].fields.lineItems[operation.lineIndex];
        if (!line)
          throw new DomainError("LINE_NOT_FOUND", 404, "Line item not found.");
        const product = (await this.products(client, workspaceId)).find(
          (item) => item.id === operation.productId,
        );
        if (!product)
          throw new DomainError("PRODUCT_NOT_FOUND", 404, "Product not found.");
        const matches = await this.matches(
          client,
          workspaceId,
          line.description,
          operation.brand,
        );
        const match = matches.find((item) => item.product.id === product.id);
        if (
          (!match || match.confidence === "uncertain") &&
          !operation.confirmUncertain
        )
          throw new DomainError(
            "PRODUCT_CONFIRMATION_REQUIRED",
            409,
            "Confirm uncertain product identity.",
          );
        resultId = product.id;
        await client.query(
          `INSERT INTO purchase_line_products (purchase_id, workspace_id, line_index, product_id, source_description, description_key, review_version, confidence, linked_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (purchase_id, line_index) DO UPDATE SET product_id = EXCLUDED.product_id, source_description = EXCLUDED.source_description,
          description_key = EXCLUDED.description_key, review_version = EXCLUDED.review_version, confidence = EXCLUDED.confidence,
          linked_by = EXCLUDED.linked_by, linked_at = now()`,
          [
            purchaseId,
            workspaceId,
            operation.lineIndex,
            resultId,
            line.description,
            categoryKey(line.description),
            operation.expectedReviewVersion,
            match?.confidence === "high" ? "high" : "confirmed",
            actorId,
          ],
        );
      }
      await client.query(
        `INSERT INTO product_events (id, workspace_id, actor_user_id, product_id, purchase_id, action)
        VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          workspaceId,
          actorId,
          resultId,
          purchaseId,
          operation.action,
        ],
      );
      await client.query(
        `INSERT INTO product_requests (workspace_id, actor_user_id, idempotency_key, payload_hash, result_id, action)
        VALUES ($1,$2,$3,$4,$5,$6)`,
        [workspaceId, actorId, input.key, hash, resultId, operation.action],
      );
      await client.query("COMMIT");
      return { id: resultId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
