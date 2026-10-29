import { assertSameOrigin } from "@/server/auth/origin";
import {
  authenticatedSession,
  parseUuid,
  withApiErrors,
} from "@/server/http/api";
import { sourceService } from "@/server/storage/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; sourceId: string }> },
) {
  return withApiErrors(async () => {
    const session = await authenticatedSession(request);
    const { workspaceId: rawWorkspaceId, sourceId: rawSourceId } =
      await context.params;
    const result = await sourceService().download(
      parseUuid(rawWorkspaceId, "workspaceId"),
      parseUuid(rawSourceId, "sourceId"),
      session.user.id,
    );
    const filename = encodeURIComponent(result.source.originalFilename).replace(
      /['()]/g,
      escape,
    );
    const body = new Uint8Array(result.bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": result.source.mediaType,
        "Content-Length": String(result.source.byteSize),
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; sourceId: string }> },
) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const session = await authenticatedSession(request);
    const { workspaceId: rawWorkspaceId, sourceId: rawSourceId } =
      await context.params;
    const result = await sourceService().remove(
      parseUuid(rawWorkspaceId, "workspaceId"),
      parseUuid(rawSourceId, "sourceId"),
      session.user.id,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}

function escape(character: string): string {
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
}
