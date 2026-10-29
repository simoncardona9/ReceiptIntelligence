import { assertSameOrigin } from "@/server/auth/origin";
import { DomainError } from "@/server/auth/contracts";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";
import { sourceService } from "@/server/storage/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new DomainError(
          "SOURCE_SIZE_INVALID",
          413,
          "Source file exceeds the 10 MB limit.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parseUuid(rawWorkspaceId, "workspaceId");
    const rawIdempotencyKey = request.headers.get("idempotency-key");
    if (!rawIdempotencyKey) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "An Idempotency-Key header is required.",
      );
    }
    const idempotencyKey = parseUuid(rawIdempotencyKey, "Idempotency-Key");
    const filename = request.headers.get("x-source-filename") ?? "";
    const declaredMediaType =
      request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const bytes = await readBoundedBody(request);
    const source = await sourceService().upload({
      workspaceId,
      actorUserId: session.user.id,
      idempotencyKey,
      filename,
      declaredMediaType,
      bytes,
    });
    return Response.json(
      { source },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
