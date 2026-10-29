import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";
import { DuplicateService } from "@/server/intake/duplicate-service";

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
    const suggestions = await new DuplicateService(
      getDatabasePool(),
    ).suggestions(workspaceId, session.user.id, receiptId);
    return Response.json(
      { suggestions },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
