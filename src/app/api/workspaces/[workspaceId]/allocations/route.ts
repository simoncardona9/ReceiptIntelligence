import { z } from "zod";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { assertSameOrigin } from "@/server/auth/origin";
import { AllocationService } from "@/server/allocations/allocation-service";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const bodySchema = z
  .object({
    purchaseId: z.uuid(),
    expectedReviewVersion: z.number().int().nonnegative(),
    primaryCategoryId: z.uuid(),
    groups: z
      .array(
        z
          .object({
            categoryId: z.uuid(),
            lineIndexes: z
              .array(z.number().int().nonnegative())
              .min(1)
              .max(200),
            overrideAmountMinor: z
              .number()
              .int()
              .nonnegative()
              .safe()
              .optional(),
            reason: z.string().trim().min(3).max(500).optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const workspaceId = parseUuid(
      (await context.params).workspaceId,
      "workspaceId",
    );
    const purchaseId = parseUuid(
      new URL(request.url).searchParams.get("purchaseId") ?? "",
      "purchaseId",
    );
    const result = await new AllocationService(getDatabasePool()).read(
      workspaceId,
      session.user.id,
      purchaseId,
    );
    return Response.json(
      { result },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export async function POST(request: Request, context: Context) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const body = await readJson(request, bodySchema);
    const result = await new AllocationService(getDatabasePool()).replace({
      workspaceId: parseUuid((await context.params).workspaceId, "workspaceId"),
      actorId: session.user.id,
      key: parseUuid(
        request.headers.get("idempotency-key") ?? "",
        "Idempotency-Key",
      ),
      ...body,
    });
    return Response.json(result);
  });
}
