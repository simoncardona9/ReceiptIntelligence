import { workspaceNameSchema } from "@/server/auth/validation";
import { workspaceService, identityService } from "@/server/auth/runtime";
import { assertSameOrigin } from "@/server/auth/origin";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const workspaces = await identityService().workspaces(session.user.id);
    return Response.json(
      { activeWorkspaceId: session.activeWorkspaceId, workspaces },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(request: Request) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const input = await readJson(request, workspaceNameSchema);
    const workspace = await workspaceService().create(
      session.user.id,
      session.id,
      request.headers.get("idempotency-key")
        ? parseUuid(request.headers.get("idempotency-key")!, "Idempotency-Key")
        : null,
      input.name,
    );
    return Response.json(
      { workspace },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
