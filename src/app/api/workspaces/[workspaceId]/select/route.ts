import { workspaceService } from "@/server/auth/runtime";
import { assertSameOrigin } from "@/server/auth/origin";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const { workspaceId } = await context.params;
    const workspace = await workspaceService().select(
      session.user.id,
      session.id,
      parseUuid(workspaceId, "workspaceId"),
    );
    return Response.json(
      { workspace },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
