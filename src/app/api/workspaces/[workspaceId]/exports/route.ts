import { z } from "zod";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { assertSameOrigin } from "@/server/auth/origin";
import { ExportService } from "@/server/exports/export-service";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const selection = z.strictObject({
  purchaseIds: z.array(z.uuid()).min(1).max(100),
  mode: z.enum(["full", "correction"]),
});
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const workspaceId = parseUuid(
      (await context.params).workspaceId,
      "workspaceId",
    );
    const history = await new ExportService(getDatabasePool()).history(
      workspaceId,
      session.user.id,
    );
    return Response.json(
      { history },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export async function POST(request: Request, context: Context) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const body = await readJson(request, selection);
    const result = await new ExportService(getDatabasePool()).create(
      parseUuid((await context.params).workspaceId, "workspaceId"),
      session.user.id,
      parseUuid(
        request.headers.get("idempotency-key") ?? "",
        "Idempotency-Key",
      ),
      body,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
