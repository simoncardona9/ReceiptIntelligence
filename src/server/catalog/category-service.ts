import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";

export type Category = {
  id: string;
  parentId: string | null;
  name: string;
  classification: "fixed" | "variable" | "discretionary" | null;
  source: "proyecto_finanzas" | "user";
  archivedAt: string | null;
  mergedIntoId: string | null;
};
const defaults = [
  ["Egresos fijos", null, "fixed"],
  ["Servicios", "Egresos fijos", "fixed"],
  ["Impuestos", "Egresos fijos", "fixed"],
  ["Gastos bancarios", "Egresos fijos", "fixed"],
  ["Egresos variables", null, "variable"],
  ["Hogar y supermercado", "Egresos variables", "variable"],
  ["Salud", "Egresos variables", "variable"],
  ["Discrecionales", null, "discretionary"],
  ["Suscripciones y regalos", "Discrecionales", "discretionary"],
] as const;

export function categoryKey(name: string): string {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-UY")
    .replace(/\s+/g, " ");
}

export class CategoryService {
  constructor(private readonly pool: Pool) {}

  private async role(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
    permission: "read" | "edit" | "owner",
  ) {
    const result = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorId],
    );
    const role = result.rows[0]?.role ?? null;
    requireWorkspacePermission(
      role,
      permission === "owner" ? "read" : permission,
    );
    if (permission === "owner" && role !== "owner")
      throw new DomainError(
        "OWNER_REQUIRED",
        403,
        "Only the workspace owner can manage category retirement.",
      );
  }

  private async all(
    client: PoolClient,
    workspaceId: string,
  ): Promise<Category[]> {
    const result = await client.query<Category>(
      `SELECT id, parent_id AS "parentId", name, classification, source,
       archived_at::text AS "archivedAt", merged_into_id AS "mergedIntoId"
       FROM categories WHERE workspace_id = $1 ORDER BY name_key, id`,
      [workspaceId],
    );
    return result.rows;
  }

  async list(workspaceId: string, actorId: string) {
    const client = await this.pool.connect();
    try {
      await this.role(client, workspaceId, actorId, "read");
      const mappings = await client.query<{
        sourceName: string;
        categoryId: string;
      }>(
        `SELECT source_name AS "sourceName", category_id AS "categoryId"
         FROM category_mappings WHERE workspace_id = $1 ORDER BY source_key`,
        [workspaceId],
      );
      return {
        categories: await this.all(client, workspaceId),
        mappings: mappings.rows,
      };
    } finally {
      client.release();
    }
  }

  async suggest(workspaceId: string, actorId: string, name: string) {
    const { categories, mappings } = await this.list(workspaceId, actorId);
    const key = categoryKey(name);
    if (!key) return { mappedCategoryId: null, suggestions: [] };
    const mapping = mappings.find(
      (item) =>
        categoryKey(item.sourceName) === key &&
        categories.some(
          (category) => category.id === item.categoryId && !category.archivedAt,
        ),
    );
    const active = categories.filter((item) => !item.archivedAt);
    const matches = active
      .map((item) => ({
        category: item,
        score:
          categoryKey(item.name) === key
            ? 100
            : categoryKey(item.name).includes(key) ||
                key.includes(categoryKey(item.name))
              ? 60
              : 0,
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return {
      mappedCategoryId: mapping?.categoryId ?? null,
      suggestions: matches,
    };
  }

  async mutate(input: {
    workspaceId: string;
    actorId: string;
    key: string;
    operation:
      | { action: "seed" }
      | { action: "create"; name: string; parentId: string | null }
      | { action: "map"; sourceName: string; categoryId: string }
      | { action: "archive"; categoryId: string }
      | { action: "merge"; categoryId: string; targetId: string };
  }) {
    const client = await this.pool.connect();
    const { workspaceId, actorId, operation } = input;
    const hash = createHash("sha256")
      .update(JSON.stringify(operation))
      .digest("hex");
    try {
      await client.query("BEGIN");
      await this.role(
        client,
        workspaceId,
        actorId,
        operation.action === "archive" || operation.action === "merge"
          ? "owner"
          : "edit",
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`categories:${workspaceId}`],
      );
      const prior = await client.query<{
        payloadHash: string;
        resultId: string;
      }>(
        `SELECT payload_hash AS "payloadHash", result_id AS "resultId" FROM category_mutations
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
      if (operation.action === "seed") {
        const existing = await client.query(
          "SELECT id FROM categories WHERE workspace_id = $1 LIMIT 1",
          [workspaceId],
        );
        if (existing.rows.length)
          throw new DomainError(
            "CATEGORY_CATALOG_EXISTS",
            409,
            "Catalog already exists.",
          );
        const ids = new Map<string, string>();
        for (const [name, parentName, classification] of defaults) {
          const id = randomUUID();
          await client.query(
            `INSERT INTO categories (id, workspace_id, parent_id, name, name_key, classification, source)
            VALUES ($1,$2,$3,$4,$5,$6,'proyecto_finanzas')`,
            [
              id,
              workspaceId,
              parentName ? ids.get(parentName) : null,
              name,
              categoryKey(name),
              classification,
            ],
          );
          ids.set(name, id);
          await this.event(client, workspaceId, actorId, id, "seed");
        }
        resultId = ids.get("Egresos fijos")!;
      } else if (operation.action === "create") {
        const parent = operation.parentId
          ? await this.active(client, workspaceId, operation.parentId)
          : null;
        if (operation.parentId && !parent)
          throw new DomainError(
            "CATEGORY_NOT_FOUND",
            404,
            "Parent category not found.",
          );
        resultId = randomUUID();
        const duplicate = await client.query(
          `SELECT id FROM categories WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND name_key = $3 AND archived_at IS NULL`,
          [workspaceId, operation.parentId, categoryKey(operation.name)],
        );
        if (duplicate.rows.length)
          throw new DomainError(
            "CATEGORY_EXISTS",
            409,
            "Category already exists under this parent.",
          );
        await client.query(
          `INSERT INTO categories (id, workspace_id, parent_id, name, name_key, source)
          VALUES ($1,$2,$3,$4,$5,'user')`,
          [
            resultId,
            workspaceId,
            operation.parentId,
            operation.name.trim(),
            categoryKey(operation.name),
          ],
        );
        await this.event(client, workspaceId, actorId, resultId, "create");
      } else if (operation.action === "map") {
        const category = await this.active(
          client,
          workspaceId,
          operation.categoryId,
        );
        if (!category)
          throw new DomainError(
            "CATEGORY_NOT_FOUND",
            404,
            "Category not found.",
          );
        const sourceKey = categoryKey(operation.sourceName);
        const existing = await client.query<{ categoryId: string }>(
          `SELECT category_id AS "categoryId" FROM category_mappings WHERE workspace_id = $1 AND source_key = $2`,
          [workspaceId, sourceKey],
        );
        if (existing.rows.length && existing.rows[0].categoryId !== category.id)
          throw new DomainError(
            "CATEGORY_MAPPING_EXISTS",
            409,
            "Mapping already points to another category.",
          );
        if (!existing.rows.length) {
          await client.query(
            `INSERT INTO category_mappings (id, workspace_id, source_name, source_key, category_id, confirmed_by)
            VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              randomUUID(),
              workspaceId,
              operation.sourceName.trim(),
              sourceKey,
              category.id,
              actorId,
            ],
          );
          await this.event(client, workspaceId, actorId, category.id, "map");
        }
        resultId = category.id;
      } else {
        const category = await this.active(
          client,
          workspaceId,
          operation.categoryId,
        );
        if (!category)
          throw new DomainError(
            "CATEGORY_NOT_FOUND",
            404,
            "Category not found.",
          );
        const children = await client.query(
          "SELECT id FROM categories WHERE workspace_id = $1 AND parent_id = $2 AND archived_at IS NULL LIMIT 1",
          [workspaceId, category.id],
        );
        if (children.rows.length)
          throw new DomainError(
            "CATEGORY_HAS_CHILDREN",
            409,
            "Archive or merge child categories first.",
          );
        if (operation.action === "merge") {
          const target = await this.active(
            client,
            workspaceId,
            operation.targetId,
          );
          if (!target || target.id === category.id)
            throw new DomainError(
              "CATEGORY_NOT_FOUND",
              404,
              "Merge target not found.",
            );
          await client.query(
            "UPDATE category_mappings SET category_id = $1 WHERE workspace_id = $2 AND category_id = $3",
            [target.id, workspaceId, category.id],
          );
        }
        await client.query(
          `UPDATE categories SET archived_at = now(), merged_into_id = $3 WHERE workspace_id = $1 AND id = $2`,
          [
            workspaceId,
            category.id,
            operation.action === "merge" ? operation.targetId : null,
          ],
        );
        await this.event(
          client,
          workspaceId,
          actorId,
          category.id,
          operation.action,
        );
        resultId = category.id;
      }
      await client.query(
        `INSERT INTO category_mutations (workspace_id, actor_user_id, idempotency_key, payload_hash, result_id, action)
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

  private async active(client: PoolClient, workspaceId: string, id: string) {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM categories WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
      [workspaceId, id],
    );
    return result.rows[0] ?? null;
  }
  private async event(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
    categoryId: string,
    action: string,
  ) {
    await client.query(
      `INSERT INTO category_events (id, workspace_id, actor_user_id, category_id, action)
      VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), workspaceId, actorId, categoryId, action],
    );
  }
}
