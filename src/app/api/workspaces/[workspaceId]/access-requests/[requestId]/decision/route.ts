import { decisionSchema } from "@/server/auth/validation";
import { workspaceService } from "@/server/auth/runtime";
import { assertSameOrigin } from "@/server/auth/origin";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; requestId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const { workspaceId: rawWorkspaceId, requestId: rawRequestId } =
      await context.params;
    const input = await readJson(request, decisionSchema);
    await workspaceService().decideAccess(
      session.user.id,
      parseUuid(rawWorkspaceId, "workspaceId"),
      parseUuid(rawRequestId, "requestId"),
      input.decision,
      input.decision === "approve" ? input.role : null,
    );
    return Response.json(
      { status: input.decision === "approve" ? "approved" : "declined" },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
