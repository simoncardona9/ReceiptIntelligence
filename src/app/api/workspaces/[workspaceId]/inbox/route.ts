import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";
import { InboxService } from "@/server/intake/inbox-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const workspaceId = parseUuid(
      (await context.params).workspaceId,
      "workspaceId",
    );
    const entries = await new InboxService(getDatabasePool()).list(
      workspaceId,
      session.user.id,
    );
    return Response.json(
      { entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
