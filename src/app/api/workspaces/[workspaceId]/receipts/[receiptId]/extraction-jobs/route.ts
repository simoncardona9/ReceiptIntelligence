import { assertSameOrigin } from "@/server/auth/origin";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";
import { extractionQueueService } from "@/server/extraction/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; receiptId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const params = await context.params;
    const workspaceId = parseUuid(params.workspaceId, "workspaceId");
    const receiptId = parseUuid(params.receiptId, "receiptId");
    const key = parseUuid(
      request.headers.get("idempotency-key") ?? "",
      "Idempotency-Key",
    );
    const result = await extractionQueueService().submit(
      workspaceId,
      session.user.id,
      receiptId,
      key,
    );
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
