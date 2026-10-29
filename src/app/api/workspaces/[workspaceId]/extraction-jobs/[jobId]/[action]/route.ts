import { z } from "zod";
import { DomainError } from "@/server/auth/contracts";
import { assertSameOrigin } from "@/server/auth/origin";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";
import { extractionQueueService } from "@/server/extraction/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceId: string; jobId: string; action: string }>;
  },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const params = await context.params;
    const workspaceId = parseUuid(params.workspaceId, "workspaceId");
    const jobId = parseUuid(params.jobId, "jobId");
    const key = parseUuid(
      request.headers.get("idempotency-key") ?? "",
      "Idempotency-Key",
    );
    const service = extractionQueueService();
    let job;
    if (params.action === "priority") {
      const body = await readJson(
        request,
        z.object({ priority: z.number().int().min(0).max(10) }).strict(),
      );
      job = await service.prioritize(
        workspaceId,
        session.user.id,
        jobId,
        body.priority,
        key,
      );
    } else if (params.action === "retry") {
      job = await service.retry(workspaceId, session.user.id, jobId, key);
    } else if (params.action === "cancel") {
      job = await service.cancel(workspaceId, session.user.id, jobId, key);
    } else {
      throw new DomainError("ACTION_NOT_FOUND", 404, "Action not found.");
    }
    return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
  });
}
