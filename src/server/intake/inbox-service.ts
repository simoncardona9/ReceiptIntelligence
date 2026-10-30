import type { Pool } from "pg";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { WorkspaceRole } from "@/server/auth/contracts";

export type InboxEntry = {
  id: string;
  origin: "receipt" | "manual";
  status: "staged" | "processing" | "failed" | "extracted" | "review";
  createdAt: string;
  merchant: string | null;
  sourceCount: number;
};

export class InboxService {
  constructor(private readonly pool: Pool) {}

  async list(workspaceId: string, actorUserId: string): Promise<InboxEntry[]> {
    const client = await this.pool.connect();
    try {
      const membership = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, actorUserId],
      );
      requireWorkspacePermission(membership.rows[0]?.role ?? null, "read");
      const result = await client.query<{
        id: string;
        origin: "receipt" | "manual";
        status: InboxEntry["status"];
        createdAt: Date;
        merchant: string | null;
        sourceCount: string;
      }>(
        `SELECT id, origin, status, "createdAt", merchant, "sourceCount" FROM (
           SELECT r.id, 'receipt'::text AS origin, r.status, r.created_at AS "createdAt",
             f.merchant_key AS merchant, count(rs.source_file_id)::text AS "sourceCount"
           FROM receipts r
           LEFT JOIN receipt_intake_facts f ON f.receipt_id = r.id AND f.workspace_id = r.workspace_id
           LEFT JOIN receipt_sources rs ON rs.receipt_id = r.id AND rs.workspace_id = r.workspace_id
           WHERE r.workspace_id = $1
           GROUP BY r.id, f.merchant_key
           UNION ALL
           SELECT m.id, 'manual'::text AS origin, m.status, m.created_at AS "createdAt",
             m.merchant, '0'::text AS "sourceCount"
           FROM manual_expenses m WHERE m.workspace_id = $1
         ) entries ORDER BY "createdAt" DESC, id DESC LIMIT 100`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        origin: row.origin,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        merchant: row.merchant,
        sourceCount: Number(row.sourceCount),
      }));
    } finally {
      client.release();
    }
  }
}
