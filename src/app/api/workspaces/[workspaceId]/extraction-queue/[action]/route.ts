import { DomainError } from "@/server/auth/contracts";
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
  context: { params: Promise<{ workspaceId: string; action: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const params = await context.params;
    const workspaceId = parseUuid(params.workspaceId, "workspaceId");
    const key = parseUuid(
      request.headers.get("idempotency-key") ?? "",
      "Idempotency-Key",
    );
    if (params.action !== "pause" && params.action !== "resume")
      throw new DomainError("ACTION_NOT_FOUND", 404, "Action not found.");
    await extractionQueueService().setPaused(
      workspaceId,
      session.user.id,
      params.action === "pause",
      key,
    );
    return Response.json(
      { paused: params.action === "pause" },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
