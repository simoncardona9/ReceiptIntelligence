import { z } from "zod";
import { assertSameOrigin } from "@/server/auth/origin";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { CategoryService } from "@/server/catalog/category-service";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seed") }).strict(),
  z
    .object({
      action: z.literal("create"),
      name: z.string().trim().min(1).max(120),
      parentId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("map"),
      sourceName: z.string().trim().min(1).max(120),
      categoryId: z.uuid(),
    })
    .strict(),
  z.object({ action: z.literal("archive"), categoryId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("merge"),
      categoryId: z.uuid(),
      targetId: z.uuid(),
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
    const service = new CategoryService(getDatabasePool());
    const name = new URL(request.url).searchParams.get("suggest");
    const result =
      name === null
        ? await service.list(workspaceId, session.user.id)
        : await service.suggest(
            workspaceId,
            session.user.id,
            name.slice(0, 120),
          );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(request: Request, context: Context) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const result = await new CategoryService(getDatabasePool()).mutate({
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
