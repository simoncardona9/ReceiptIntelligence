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
import { reviewFieldsSchema } from "@/server/review/fields";
import { ReviewService } from "@/server/review/review-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const paramsSchema = z.enum(["receipt", "manual"]);
function parseOrigin(value: string) {
  const parsed = paramsSchema.safeParse(value);
  if (!parsed.success)
    throw new DomainError("INVALID_ORIGIN", 400, "Invalid review origin.");
  return parsed.data;
}
const correctionSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    expectedBaseProposalId: z.uuid().nullable(),
    reason: z.string().trim().min(3).max(500),
    fields: reviewFieldsSchema,
  })
  .strict();
type Context = {
  params: Promise<{ workspaceId: string; origin: string; originId: string }>;
};

export async function GET(request: Request, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const p = await context.params;
    const review = await new ReviewService(getDatabasePool()).read(
      parseUuid(p.workspaceId, "workspaceId"),
      session.user.id,
      parseOrigin(p.origin),
      parseUuid(p.originId, "originId"),
    );
    return Response.json(
      { review },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function PATCH(request: Request, context: Context) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const p = await context.params;
    const body = await readJson(request, correctionSchema);
    const review = await new ReviewService(getDatabasePool()).correct({
      workspaceId: parseUuid(p.workspaceId, "workspaceId"),
      actorUserId: session.user.id,
      origin: parseOrigin(p.origin),
      originId: parseUuid(p.originId, "originId"),
      idempotencyKey: parseUuid(
        request.headers.get("idempotency-key") ?? "",
        "Idempotency-Key",
      ),
      expectedVersion: body.expectedVersion,
      expectedBaseProposalId: body.expectedBaseProposalId,
      reason: body.reason,
      fields: body.fields,
    });
    return Response.json(
      { review },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
