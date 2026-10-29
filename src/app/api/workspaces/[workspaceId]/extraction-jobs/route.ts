import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";
import { extractionQueueService } from "@/server/extraction/runtime";

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
    const queue = await extractionQueueService().list(
      workspaceId,
      session.user.id,
    );
    return Response.json(
      { queue },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
