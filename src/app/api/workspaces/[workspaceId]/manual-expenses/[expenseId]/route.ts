import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";
import { ManualService } from "@/server/intake/manual-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; expenseId: string }> },
) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const params = await context.params;
    const expense = await new ManualService(getDatabasePool()).get(
      parseUuid(params.workspaceId, "workspaceId"),
      session.user.id,
      parseUuid(params.expenseId, "expenseId"),
    );
    return Response.json(
      { expense },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
