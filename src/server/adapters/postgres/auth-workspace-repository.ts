import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  DomainError,
  type AuditEvent,
  type AccessDecision,
  type AccessRequestSummary,
  type SessionContext,
  type UserCredential,
  type WorkspaceRole,
  type WorkspaceSummary,
} from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type {
  IdentityRepository,
  WorkspaceRepository,
} from "@/server/auth/repositories";

type TransactionWork<T> = (client: PoolClient) => Promise<T>;

async function inTransaction<T>(
  pool: Pool,
  work: TransactionWork<T>,
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

function mapWorkspace(row: {
  id: string;
  name: string;
  role: WorkspaceRole;
}): WorkspaceSummary {
  return { id: row.id, name: row.name, role: row.role };
}

export class PostgresAuthWorkspaceRepository
  implements IdentityRepository, WorkspaceRepository
{
  constructor(private readonly pool: Pool) {}

  async bootstrapOwner(input: {
    email: string;
    passwordHash: string;
    workspaceName: string;
  }): Promise<boolean> {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    return inTransaction(this.pool, async (client) => {
      const created = await client.query<{ id: string }>(
        `INSERT INTO users (id, email, email_normalized, password_hash)
         VALUES ($1, $2, $2, $3)
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [userId, input.email, input.passwordHash],
      );
      if (!created.rowCount) return false;

      await client.query(
        "INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)",
        [workspaceId, input.workspaceName, userId],
      );
      await client.query(
        `INSERT INTO memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [workspaceId, userId],
      );
      await this.appendAudit(client, {
        actorUserId: userId,
        workspaceId: null,
        action: "account_registered",
        subjectId: userId,
      });
      await this.appendAudit(client, {
        actorUserId: userId,
        workspaceId,
        action: "workspace_created",
        subjectId: workspaceId,
      });
      return true;
    });
  }

  async registerAccount(input: {
    email: string;
    passwordHash: string;
  }): Promise<void> {
    const userId = randomUUID();
    await inTransaction(this.pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (id, email, email_normalized, password_hash)
         VALUES ($1, $2, $2, $3)
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [userId, input.email, input.passwordHash],
      );
      if (!result.rowCount) return;
      await this.appendAudit(client, {
        actorUserId: userId,
        workspaceId: null,
        action: "account_registered",
        subjectId: userId,
      });
    });
  }

  async findUserByEmail(email: string): Promise<UserCredential | null> {
    const result = await this.pool.query<UserCredential>(
      `SELECT id, email, password_hash AS "passwordHash"
       FROM users WHERE email_normalized = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const sessionId = randomUUID();
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, input.userId, input.tokenHash, input.expiresAt],
      );
      await this.appendAudit(client, {
        actorUserId: input.userId,
        workspaceId: null,
        action: "session_created",
        subjectId: sessionId,
      });
    });
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<SessionContext | null> {
    const result = await this.pool.query<{
      id: string;
      userId: string;
      email: string;
      activeWorkspaceId: string | null;
      expiresAt: Date;
    }>(
      `SELECT s.id, s.user_id AS "userId", u.email,
              s.active_workspace_id AS "activeWorkspaceId", s.expires_at AS "expiresAt"
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          user: { id: row.userId, email: row.email },
          activeWorkspaceId: row.activeWorkspaceId,
          expiresAt: row.expiresAt.toISOString(),
        }
      : null;
  }

  async revokeSessionByTokenHash(tokenHash: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const result = await client.query<{
        id: string;
        userId: string;
        workspaceId: string | null;
      }>(
        `UPDATE auth_sessions SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id, user_id AS "userId", active_workspace_id AS "workspaceId"`,
        [tokenHash],
      );
      const session = result.rows[0];
      if (session) {
        await this.appendAudit(client, {
          actorUserId: session.userId,
          workspaceId: session.workspaceId,
          action: "session_revoked",
          subjectId: session.id,
        });
      }
    });
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    const result = await this.pool.query<WorkspaceSummary>(
      `SELECT w.id, w.name, m.role
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1 ORDER BY w.created_at, w.id`,
      [userId],
    );
    return result.rows;
  }

  async createWorkspace(input: {
    userId: string;
    sessionId: string;
    idempotencyKey: string;
    name: string;
  }): Promise<WorkspaceSummary> {
    const operation = "workspace.create";
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ name: input.name }))
      .digest("hex");

    return inTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO idempotency_records
           (user_id, operation, idempotency_key, request_hash, response_json)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)
         ON CONFLICT (user_id, operation, idempotency_key) DO NOTHING`,
        [input.userId, operation, input.idempotencyKey, requestHash],
      );
      const stored = await client.query<{
        requestHash: string;
        response: { id?: string; name?: string; role?: WorkspaceRole };
      }>(
        `SELECT request_hash AS "requestHash", response_json AS response
         FROM idempotency_records
         WHERE user_id = $1 AND operation = $2 AND idempotency_key = $3
         FOR UPDATE`,
        [input.userId, operation, input.idempotencyKey],
      );
      const record = stored.rows[0];
      if (record.requestHash !== requestHash) {
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "This request key was already used for different input.",
        );
      }

      let workspace: WorkspaceSummary;
      if (record.response.id && record.response.name) {
        workspace = {
          id: record.response.id,
          name: record.response.name,
          role: "owner",
        };
        const membership = await client.query(
          `SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
          [workspace.id, input.userId],
        );
        if (!membership.rowCount) {
          throw new DomainError(
            "WORKSPACE_NOT_FOUND",
            404,
            "Workspace not found.",
          );
        }
      } else {
        const workspaceId = randomUUID();
        await client.query(
          `INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)`,
          [workspaceId, input.name, input.userId],
        );
        await client.query(
          `INSERT INTO memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, input.userId],
        );
        workspace = { id: workspaceId, name: input.name, role: "owner" };
        await client.query(
          `UPDATE idempotency_records SET response_json = $4::jsonb
           WHERE user_id = $1 AND operation = $2 AND idempotency_key = $3`,
          [
            input.userId,
            operation,
            input.idempotencyKey,
            JSON.stringify(workspace),
          ],
        );
        await this.appendAudit(client, {
          actorUserId: input.userId,
          workspaceId,
          action: "workspace_created",
          subjectId: workspaceId,
        });
      }

      const session = await client.query(
        `UPDATE auth_sessions SET active_workspace_id = $3
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
        [input.sessionId, input.userId, workspace.id],
      );
      if (!session.rowCount) {
        throw new DomainError(
          "AUTHENTICATION_REQUIRED",
          401,
          "Sign in to continue.",
        );
      }
      return workspace;
    });
  }

  async selectWorkspace(input: {
    userId: string;
    sessionId: string;
    workspaceId: string;
  }): Promise<WorkspaceSummary> {
    return inTransaction(this.pool, async (client) => {
      const membership = await client.query<{
        id: string;
        name: string;
        role: WorkspaceRole;
      }>(
        `SELECT w.id, w.name, m.role
         FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.workspace_id = $1 AND m.user_id = $2`,
        [input.workspaceId, input.userId],
      );
      const workspace = membership.rows[0];
      if (!workspace) {
        throw new DomainError(
          "WORKSPACE_NOT_FOUND",
          404,
          "Workspace not found.",
        );
      }

      const session = await client.query(
        `UPDATE auth_sessions SET active_workspace_id = $3
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
        [input.sessionId, input.userId, input.workspaceId],
      );
      if (!session.rowCount) {
        throw new DomainError(
          "AUTHENTICATION_REQUIRED",
          401,
          "Sign in to continue.",
        );
      }
      await this.appendAudit(client, {
        actorUserId: input.userId,
        workspaceId: input.workspaceId,
        action: "workspace_selected",
        subjectId: input.workspaceId,
      });
      return mapWorkspace(workspace);
    });
  }

  async requestAccess(input: {
    userId: string;
    workspaceId: string;
  }): Promise<{ id: string; workspaceId: string; status: "pending" }> {
    return inTransaction(this.pool, async (client) => {
      const workspace = await client.query(
        "SELECT 1 FROM workspaces WHERE id = $1",
        [input.workspaceId],
      );
      if (!workspace.rowCount) {
        throw new DomainError(
          "WORKSPACE_NOT_FOUND",
          404,
          "Workspace not found.",
        );
      }
      const member = await client.query(
        "SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2",
        [input.workspaceId, input.userId],
      );
      if (member.rowCount) {
        throw new DomainError(
          "ALREADY_A_MEMBER",
          409,
          "You already belong to this workspace.",
        );
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO access_requests (id, workspace_id, user_id, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (workspace_id, user_id) WHERE status = 'pending' DO NOTHING
         RETURNING id`,
        [randomUUID(), input.workspaceId, input.userId],
      );
      const request = inserted.rows[0];
      if (request) {
        await this.appendAudit(client, {
          actorUserId: input.userId,
          workspaceId: input.workspaceId,
          action: "access_requested",
          subjectId: request.id,
        });
        return {
          id: request.id,
          workspaceId: input.workspaceId,
          status: "pending",
        };
      }

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM access_requests
         WHERE workspace_id = $1 AND user_id = $2 AND status = 'pending'`,
        [input.workspaceId, input.userId],
      );
      if (!existing.rows[0]) {
        throw new DomainError(
          "REQUEST_CONFLICT",
          409,
          "Access request could not be created.",
        );
      }
      return {
        id: existing.rows[0].id,
        workspaceId: input.workspaceId,
        status: "pending",
      };
    });
  }

  async listPendingRequests(input: {
    ownerId: string;
    workspaceId: string;
  }): Promise<AccessRequestSummary[]> {
    const membership = await this.pool.query<{ role: WorkspaceRole }>(
      `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
      [input.workspaceId, input.ownerId],
    );
    requireWorkspacePermission(
      membership.rows[0]?.role ?? null,
      "manage_access",
    );

    const result = await this.pool.query<AccessRequestSummary>(
      `SELECT r.id, r.workspace_id AS "workspaceId", r.user_id AS "userId",
              u.email, r.status, r.requested_at AS "requestedAt"
       FROM access_requests r JOIN users u ON u.id = r.user_id
       WHERE r.workspace_id = $1 AND r.status = 'pending'
       ORDER BY r.requested_at, r.id`,
      [input.workspaceId],
    );
    return result.rows;
  }

  async decideAccessRequest(input: {
    ownerId: string;
    workspaceId: string;
    requestId: string;
    decision: AccessDecision;
    role: Exclude<WorkspaceRole, "owner"> | null;
  }): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const membership = await client.query<{ role: WorkspaceRole }>(
        `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
        [input.workspaceId, input.ownerId],
      );
      requireWorkspacePermission(
        membership.rows[0]?.role ?? null,
        "manage_access",
      );

      const found = await client.query<{
        id: string;
        userId: string;
        status: "pending" | "approved" | "declined";
        role: "editor" | "viewer" | null;
      }>(
        `SELECT id, user_id AS "userId", status, decided_role AS role
         FROM access_requests
         WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [input.requestId, input.workspaceId],
      );
      const accessRequest = found.rows[0];
      if (!accessRequest) {
        throw new DomainError(
          "ACCESS_REQUEST_NOT_FOUND",
          404,
          "Access request not found.",
        );
      }

      const nextStatus = input.decision === "approve" ? "approved" : "declined";
      if (accessRequest.status !== "pending") {
        if (
          accessRequest.status === nextStatus &&
          (nextStatus === "declined" || accessRequest.role === input.role)
        ) {
          return;
        }
        throw new DomainError(
          "ACCESS_REQUEST_DECIDED",
          409,
          "This access request was already decided.",
        );
      }

      if (input.decision === "approve" && input.role) {
        await client.query(
          `INSERT INTO memberships (workspace_id, user_id, role)
           VALUES ($1, $2, $3)`,
          [input.workspaceId, accessRequest.userId, input.role],
        );
      }
      await client.query(
        `UPDATE access_requests SET status = $3, decided_at = now(),
           decided_by = $4, decided_role = $5
         WHERE id = $1 AND workspace_id = $2`,
        [
          input.requestId,
          input.workspaceId,
          nextStatus,
          input.ownerId,
          input.decision === "approve" ? input.role : null,
        ],
      );
      await this.appendAudit(client, {
        actorUserId: input.ownerId,
        workspaceId: input.workspaceId,
        action:
          input.decision === "approve" ? "access_approved" : "access_declined",
        subjectId: input.requestId,
        ...(input.decision === "approve" && input.role
          ? { metadata: { role: input.role } }
          : {}),
      });
    });
  }

  private async appendAudit(
    client: PoolClient,
    event: AuditEvent,
  ): Promise<void> {
    await client.query(
      `INSERT INTO auth_audit_events
         (id, actor_user_id, workspace_id, action, subject_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        randomUUID(),
        event.actorUserId,
        event.workspaceId,
        event.action,
        event.subjectId,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  }
}
