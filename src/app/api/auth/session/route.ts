import { identityService } from "@/server/auth/runtime";
import { readSessionToken } from "@/server/auth/session-token";
import { withApiErrors } from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiErrors(async () => {
    const identity = identityService();
    const session = await identity.currentSession(readSessionToken(request));
    const workspaces = await identity.workspaces(session.user.id);
    return Response.json(
      {
        user: session.user,
        activeWorkspaceId: session.activeWorkspaceId,
        workspaces,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
