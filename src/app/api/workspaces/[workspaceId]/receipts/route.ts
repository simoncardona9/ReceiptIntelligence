import { z } from "zod";
import { assertSameOrigin } from "@/server/auth/origin";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";
import { ReceiptService } from "@/server/intake/receipt-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({ sourceIds: z.array(z.uuid()).min(1).max(20) })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const workspaceId = parseUuid(
      (await context.params).workspaceId,
      "workspaceId",
    );
    const idempotencyKey = parseUuid(
      request.headers.get("idempotency-key") ?? "",
      "Idempotency-Key",
    );
    const body = await readJson(request, bodySchema);
    const result = await new ReceiptService(getDatabasePool()).stage({
      workspaceId,
      actorUserId: session.user.id,
      idempotencyKey,
      sourceIds: body.sourceIds,
    });
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
