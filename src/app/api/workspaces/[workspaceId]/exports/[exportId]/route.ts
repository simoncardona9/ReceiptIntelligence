import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { ExportService } from "@/server/exports/export-service";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; exportId: string }> };
export async function GET(request: Request, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const params = await context.params;
    const exportId = parseUuid(params.exportId, "exportId");
    const zip = await new ExportService(getDatabasePool()).download(
      parseUuid(params.workspaceId, "workspaceId"),
      session.user.id,
      exportId,
    );
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="receipt-export-${exportId}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
