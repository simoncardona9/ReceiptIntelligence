import { z } from "zod";
import { DomainError } from "@/server/auth/contracts";
import { assertSameOrigin } from "@/server/auth/origin";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";
import { ReviewService } from "@/server/review/review-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = {
  params: Promise<{ workspaceId: string; origin: string; originId: string }>;
};
const common = {
  expectedVersion: z.number().int().nonnegative(),
  expectedBaseProposalId: z.uuid().nullable(),
};
const bodySchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("approve") }).strict(),
  z
    .object({
      ...common,
      action: z.literal("reject"),
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
  z
    .object({ ...common, action: z.literal("auto"), enabled: z.boolean() })
    .strict(),
]);

export async function POST(request: Request, context: Context) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const params = await context.params;
    if (params.origin !== "receipt" && params.origin !== "manual")
      throw new DomainError("INVALID_ORIGIN", 400, "Invalid review origin.");
    const body = await readJson(request, bodySchema);
    const { expectedVersion, expectedBaseProposalId, ...decision } = body;
    const review = await new ReviewService(getDatabasePool()).act({
      workspaceId: parseUuid(params.workspaceId, "workspaceId"),
      actorUserId: session.user.id,
      origin: params.origin,
      originId: parseUuid(params.originId, "originId"),
      idempotencyKey: parseUuid(
        request.headers.get("idempotency-key") ?? "",
        "Idempotency-Key",
      ),
      expectedVersion,
      expectedBaseProposalId,
      decision,
    });
    return Response.json(
      { review },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
