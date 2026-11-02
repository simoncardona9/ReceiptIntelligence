import { z } from "zod";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { assertSameOrigin } from "@/server/auth/origin";
import { ApprovedRecordService } from "@/server/records/approved-record-service";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const bodySchema = z
  .object({
    action: z.enum(["archive", "restore"]),
    expectedArchived: z.boolean(),
  })
  .strict();
type Context = { params: Promise<{ workspaceId: string; purchaseId: string }> };
export async function GET(request: Request, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const params = await context.params;
    const result = await new ApprovedRecordService(getDatabasePool()).detail(
      parseUuid(params.workspaceId, "workspaceId"),
      session.user.id,
      parseUuid(params.purchaseId, "purchaseId"),
    );
    return Response.json(
      { record: result },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export async function POST(request: Request, context: Context) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const params = await context.params;
    const body = await readJson(request, bodySchema);
    const result = await new ApprovedRecordService(getDatabasePool()).archive({
      workspaceId: parseUuid(params.workspaceId, "workspaceId"),
      actorId: session.user.id,
      purchaseId: parseUuid(params.purchaseId, "purchaseId"),
      key: parseUuid(
        request.headers.get("idempotency-key") ?? "",
        "Idempotency-Key",
      ),
      ...body,
    });
    return Response.json(result);
  });
}
