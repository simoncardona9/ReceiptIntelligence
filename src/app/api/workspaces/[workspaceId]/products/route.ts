import { z } from "zod";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { assertSameOrigin } from "@/server/auth/origin";
import { ProductService } from "@/server/catalog/product-service";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const name = z.string().trim().min(1).max(160);
const brand = z.string().trim().min(1).max(120).nullable();
const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, brand }).strict(),
  z
    .object({ action: z.literal("rename"), productId: z.uuid(), name, brand })
    .strict(),
  z
    .object({
      action: z.literal("link"),
      purchaseId: z.uuid(),
      lineIndex: z.number().int().nonnegative(),
      productId: z.uuid(),
      brand,
      confirmUncertain: z.boolean(),
      expectedReviewVersion: z.number().int().nonnegative(),
    })
    .strict(),
]);
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const workspaceId = parseUuid(
      (await context.params).workspaceId,
      "workspaceId",
    );
    const service = new ProductService(getDatabasePool());
    const url = new URL(request.url);
    const purchaseId = url.searchParams.get("purchaseId");
    const description = url.searchParams.get("suggest");
    const result = purchaseId
      ? await service.lines(
          workspaceId,
          session.user.id,
          parseUuid(purchaseId, "purchaseId"),
        )
      : description !== null
        ? await service.suggest(
            workspaceId,
            session.user.id,
            description.slice(0, 240),
            url.searchParams.get("brand"),
          )
        : await service.list(workspaceId, session.user.id);
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
    const result = await new ProductService(getDatabasePool()).mutate({
      workspaceId: parseUuid((await context.params).workspaceId, "workspaceId"),
      actorId: session.user.id,
      key: parseUuid(
        request.headers.get("idempotency-key") ?? "",
        "Idempotency-Key",
      ),
      operation: await readJson(request, operation),
    });
    return Response.json(result);
  });
}
