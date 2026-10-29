import type { Pool } from "pg";
import { DomainError, type WorkspaceRole } from "@/server/auth/contracts";
import { requireWorkspacePermission } from "@/server/auth/authorization";
import type { Proposal } from "@/server/extraction/normalization";

export type StoredProposal = {
  id: string;
  receiptId: string;
  jobId: string;
  createdAt: string;
  proposal: Proposal;
};

export class PostgresProposalRepository {
  constructor(private readonly pool: Pool) {}

  async latest(
    workspaceId: string,
    actorUserId: string,
    receiptId: string,
  ): Promise<StoredProposal> {
    const membership = await this.pool.query<{ role: WorkspaceRole }>(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, actorUserId],
    );
    requireWorkspacePermission(membership.rows[0]?.role ?? null, "read");
    const result = await this.pool.query<{
      id: string;
      receiptId: string;
      jobId: string;
      createdAt: Date;
      proposal: Proposal;
    }>(
      `SELECT id, receipt_id AS "receiptId", job_id AS "jobId",
       created_at AS "createdAt", proposal FROM receipt_proposals
       WHERE workspace_id = $1 AND receipt_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [workspaceId, receiptId],
    );
    if (!result.rows[0])
      throw new DomainError("PROPOSAL_NOT_FOUND", 404, "Proposal not found.");
    return {
      ...result.rows[0],
      createdAt: result.rows[0].createdAt.toISOString(),
    };
  }
}
