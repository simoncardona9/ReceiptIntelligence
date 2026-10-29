import { PostgresProposalRepository } from "@/server/adapters/postgres/proposal-repository";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
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
    const stored = await new PostgresProposalRepository(
      getDatabasePool(),
    ).latest(workspaceId, session.user.id, receiptId);
    return Response.json(
      { stored },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
