import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type {
  SourceFile,
  SourceMetadata,
  SourceRepository,
} from "@/server/storage/contracts";

async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
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

type SourceRow = {
  id: string;
  workspaceId: string;
  storageKey: string;
  contentHash: string;
  mediaType: SourceMetadata["mediaType"];
  originalFilename: string;
  byteSize: string;
  uploadedBy: string;
  uploadedAt: Date;
  removedAt: Date | null;
  removedBy: string | null;
};

function toSource(row: SourceRow): SourceFile {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contentHash: row.contentHash,
    mediaType: row.mediaType,
    originalFilename: row.originalFilename,
    byteSize: Number(row.byteSize),
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
    removedBy: row.removedBy,
  };
}

export class PostgresSourceRepository implements SourceRepository {
  constructor(private readonly pool: Pool) {}

  async authorizeUpload(input: {
    workspaceId: string;
    actorUserId: string;
  }): Promise<void> {
    const result = await this.pool.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [input.workspaceId, input.actorUserId],
    );
    requireWorkspacePermission(result.rows[0]?.role ?? null, "edit");
  }

  async create(
    input: SourceMetadata,
    idempotencyKey: string,
  ): Promise<{ source: SourceFile; created: boolean }> {
    return transaction(this.pool, async (client) => {
      await this.requireRole(
        client,
        input.workspaceId,
        input.uploadedBy,
        "edit",
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`source:${input.workspaceId}:${input.uploadedBy}:${idempotencyKey}`],
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`source-content:${input.workspaceId}:${input.contentHash}`],
      );
      const previous = await client.query<{
        contentHash: string;
        sourceId: string;
      }>(
        `SELECT content_hash AS "contentHash", source_file_id AS "sourceId"
         FROM source_upload_idempotency
         WHERE workspace_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
        [input.workspaceId, input.uploadedBy, idempotencyKey],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].contentHash !== input.contentHash) {
          throw new DomainError(
            "IDEMPOTENCY_KEY_REUSED",
            409,
            "This request key was already used for different source content.",
          );
        }
        const existing = await client.query<SourceRow>(
          `SELECT id, workspace_id AS "workspaceId", storage_key AS "storageKey",
            content_hash AS "contentHash", media_type AS "mediaType", original_filename AS "originalFilename",
            byte_size AS "byteSize", uploaded_by AS "uploadedBy", uploaded_at AS "uploadedAt",
            removed_at AS "removedAt", removed_by AS "removedBy"
           FROM source_files WHERE id = $1 AND workspace_id = $2`,
          [previous.rows[0].sourceId, input.workspaceId],
        );
        if (!existing.rows[0])
          throw new DomainError(
            "SOURCE_NOT_FOUND",
            404,
            "Source file not found.",
          );
        return { source: toSource(existing.rows[0]), created: false };
      }
      const sameContent = await client.query<SourceRow>(
        `SELECT id, workspace_id AS "workspaceId", storage_key AS "storageKey",
          content_hash AS "contentHash", media_type AS "mediaType", original_filename AS "originalFilename",
          byte_size AS "byteSize", uploaded_by AS "uploadedBy", uploaded_at AS "uploadedAt",
          removed_at AS "removedAt", removed_by AS "removedBy"
         FROM source_files WHERE workspace_id = $1 AND content_hash = $2 AND removed_at IS NULL
         ORDER BY uploaded_at, id LIMIT 1`,
        [input.workspaceId, input.contentHash],
      );
      if (sameContent.rows[0]) {
        await client.query(
          `INSERT INTO source_upload_idempotency (workspace_id, actor_user_id, idempotency_key, content_hash, source_file_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            input.workspaceId,
            input.uploadedBy,
            idempotencyKey,
            input.contentHash,
            sameContent.rows[0].id,
          ],
        );
        return { source: toSource(sameContent.rows[0]), created: false };
      }
      const result = await client.query<SourceRow>(
        `INSERT INTO source_files
         (id, workspace_id, storage_key, content_hash, media_type, original_filename, byte_size, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, workspace_id AS "workspaceId", storage_key AS "storageKey",
           content_hash AS "contentHash", media_type AS "mediaType", original_filename AS "originalFilename",
           byte_size AS "byteSize", uploaded_by AS "uploadedBy", uploaded_at AS "uploadedAt",
           removed_at AS "removedAt", removed_by AS "removedBy"`,
        [
          input.id,
          input.workspaceId,
          input.storageKey,
          input.contentHash,
          input.mediaType,
          input.originalFilename,
          input.byteSize,
          input.uploadedBy,
          input.uploadedAt,
        ],
      );
      await client.query(
        `INSERT INTO source_upload_idempotency (workspace_id, actor_user_id, idempotency_key, content_hash, source_file_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          input.workspaceId,
          input.uploadedBy,
          idempotencyKey,
          input.contentHash,
          input.id,
        ],
      );
      await this.audit(
        client,
        input.workspaceId,
        input.uploadedBy,
        input.id,
        "source_uploaded",
      );
      return { source: toSource(result.rows[0]), created: true };
    });
  }

  async findForDownload(input: {
    workspaceId: string;
    sourceId: string;
    actorUserId: string;
  }): Promise<SourceMetadata> {
    const row = await this.findAuthorized(input, "read");
    if (row.removedAt)
      throw new DomainError("SOURCE_NOT_FOUND", 404, "Source file not found.");
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      storageKey: row.storageKey,
      contentHash: row.contentHash,
      mediaType: row.mediaType,
      originalFilename: row.originalFilename,
      byteSize: Number(row.byteSize),
      uploadedBy: row.uploadedBy,
      uploadedAt: row.uploadedAt.toISOString(),
    };
  }

  async recordDownload(input: {
    workspaceId: string;
    sourceId: string;
    actorUserId: string;
  }): Promise<void> {
    await transaction(this.pool, async (client) => {
      await this.requireRole(
        client,
        input.workspaceId,
        input.actorUserId,
        "read",
      );
      const found = await client.query(
        "SELECT 1 FROM source_files WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL FOR SHARE",
        [input.sourceId, input.workspaceId],
      );
      if (!found.rowCount)
        throw new DomainError(
          "SOURCE_NOT_FOUND",
          404,
          "Source file not found.",
        );
      await this.audit(
        client,
        input.workspaceId,
        input.actorUserId,
        input.sourceId,
        "source_downloaded",
      );
    });
  }

  async markRemoved(input: {
    workspaceId: string;
    sourceId: string;
    actorUserId: string;
  }): Promise<{ storageKey: string; removed: boolean }> {
    return transaction(this.pool, async (client) => {
      await this.requireRole(
        client,
        input.workspaceId,
        input.actorUserId,
        "edit",
      );
      const found = await client.query<{
        storageKey: string;
        removedAt: Date | null;
      }>(
        `SELECT storage_key AS "storageKey", removed_at AS "removedAt"
         FROM source_files WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [input.sourceId, input.workspaceId],
      );
      const source = found.rows[0];
      if (!source)
        throw new DomainError(
          "SOURCE_NOT_FOUND",
          404,
          "Source file not found.",
        );
      if (source.removedAt)
        return { storageKey: source.storageKey, removed: false };
      await client.query(
        "UPDATE source_files SET removed_at = now(), removed_by = $3 WHERE id = $1 AND workspace_id = $2",
        [input.sourceId, input.workspaceId, input.actorUserId],
      );
      await this.audit(
        client,
        input.workspaceId,
        input.actorUserId,
        input.sourceId,
        "source_removed",
      );
      return { storageKey: source.storageKey, removed: true };
    });
  }

  private async findAuthorized(
    input: { workspaceId: string; sourceId: string; actorUserId: string },
    permission: "read" | "edit",
  ): Promise<SourceRow> {
    const role = await this.pool.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [input.workspaceId, input.actorUserId],
    );
    requireWorkspacePermission(role.rows[0]?.role ?? null, permission);
    const result = await this.pool.query<SourceRow>(
      `SELECT id, workspace_id AS "workspaceId", storage_key AS "storageKey",
        content_hash AS "contentHash", media_type AS "mediaType", original_filename AS "originalFilename",
        byte_size AS "byteSize", uploaded_by AS "uploadedBy", uploaded_at AS "uploadedAt",
        removed_at AS "removedAt", removed_by AS "removedBy"
       FROM source_files WHERE id = $1 AND workspace_id = $2`,
      [input.sourceId, input.workspaceId],
    );
    if (!result.rows[0])
      throw new DomainError("SOURCE_NOT_FOUND", 404, "Source file not found.");
    return result.rows[0];
  }

  private async requireRole(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    permission: "read" | "edit",
  ): Promise<void> {
    const result = await client.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );
    requireWorkspacePermission(result.rows[0]?.role ?? null, permission);
  }

  private async audit(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    sourceId: string,
    action: "source_uploaded" | "source_downloaded" | "source_removed",
  ): Promise<void> {
    await client.query(
      `INSERT INTO source_audit_events (id, workspace_id, actor_user_id, source_file_id, action)
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), workspaceId, actorUserId, sourceId, action],
    );
  }
}
