import { workspaceService } from "@/server/auth/runtime";
import { assertSameOrigin } from "@/server/auth/origin";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parseUuid(rawWorkspaceId, "workspaceId");
    const requests = await workspaceService().pendingRequests(
      session.user.id,
      workspaceId,
    );
    return Response.json(
      { requests },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const { workspaceId: rawWorkspaceId } = await context.params;
    const requestResult = await workspaceService().requestAccess(
      session.user.id,
      parseUuid(rawWorkspaceId, "workspaceId"),
    );
    return Response.json(
      { request: requestResult },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  });
}
