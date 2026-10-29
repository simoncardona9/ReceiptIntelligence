import { z } from "zod";
import { assertSameOrigin } from "@/server/auth/origin";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";
import { DuplicateService } from "@/server/intake/duplicate-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
      receiptId: string;
      candidateId: string;
    }>;
  },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const params = await context.params;
    const body = await readJson(
      request,
      z.object({ decision: z.enum(["same", "different"]) }).strict(),
    );
    const result = await new DuplicateService(getDatabasePool()).decide({
      workspaceId: parseUuid(params.workspaceId, "workspaceId"),
      actorUserId: session.user.id,
      receiptId: parseUuid(params.receiptId, "receiptId"),
      candidateId: parseUuid(params.candidateId, "candidateId"),
      decision: body.decision,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
