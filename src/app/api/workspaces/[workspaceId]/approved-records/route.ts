import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { ApprovedRecordService } from "@/server/records/approved-record-service";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const url = new URL(request.url);
    const result = await new ApprovedRecordService(getDatabasePool()).list(
      parseUuid((await context.params).workspaceId, "workspaceId"),
      session.user.id,
      (url.searchParams.get("q") ?? "").slice(0, 160),
      url.searchParams.get("includeArchived") === "true",
    );
    return Response.json(
      { records: result },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
