import { z } from "zod";
import { assertSameOrigin } from "@/server/auth/origin";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import {
  authenticatedSession,
  parseUuid,
  readJson,
  withApiErrors,
} from "@/server/http/api";
import { ManualService } from "@/server/intake/manual-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const money = z.number().int().nonnegative().safe();
const fields = z
  .object({
    merchant: z.string().trim().min(1).max(160),
    date: z.iso.date(),
    totalMinor: money,
    currency: z.enum(["UYU", "USD"]),
    categoryName: z.string().trim().min(1).max(120).optional(),
    lines: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(240),
            quantityMilli: z.number().int().positive().safe(),
            totalMinor: money,
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const workspaceId = parseUuid(
      (await context.params).workspaceId,
      "workspaceId",
    );
    const idempotencyKey = parseUuid(
      request.headers.get("idempotency-key") ?? "",
      "Idempotency-Key",
    );
    const input = await readJson(request, fields);
    const result = await new ManualService(getDatabasePool()).create({
      workspaceId,
      actorUserId: session.user.id,
      idempotencyKey,
      fields: input,
    });
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
