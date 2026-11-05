import { PostgresProposalRepository } from "@/server/adapters/postgres/proposal-repository";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  normalizeExtraction,
  type Proposal,
} from "@/server/extraction/normalization";
import type { ExtractionResult } from "@/server/extraction/contracts";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; receiptId: string }> },
) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const params = await context.params;
    const workspaceId = parseUuid(params.workspaceId, "workspaceId");
    const receiptId = parseUuid(params.receiptId, "receiptId");
    const pool = getDatabasePool();
    const stored = await new PostgresProposalRepository(pool).latest(
      workspaceId,
      session.user.id,
      receiptId,
    );
    let taxAnalysis: Proposal["taxLines"] = stored.proposal.taxLines;
    let lineAnalysis = stored.proposal.lineItems;
    if (!taxAnalysis) {
      const evidence = await pool.query<{
        engine: ExtractionResult["engine"];
        device: ExtractionResult["device"];
        pages: ExtractionResult["pages"];
      }>(
        `SELECT engine, device, pages FROM extraction_evidence
         WHERE workspace_id = $1 AND receipt_id = $2 AND job_id = $3`,
        [workspaceId, receiptId, stored.jobId],
      );
      if (evidence.rows[0]) {
        const analysis = normalizeExtraction({
          version: 1,
          ...evidence.rows[0],
          diagnostics: { durationMs: 0 },
        });
        taxAnalysis = analysis.taxLines;
        lineAnalysis = analysis.lineItems;
      }
    }
    return Response.json(
      { stored, taxAnalysis: taxAnalysis ?? [], lineAnalysis },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
