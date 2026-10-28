import { identityService } from "@/server/auth/runtime";
import { assertSameOrigin } from "@/server/auth/origin";
import {
  clearSessionCookie,
  readSessionToken,
} from "@/server/auth/session-token";
import { withApiErrors } from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    await identityService().logout(readSessionToken(request));
    return Response.json(
      { status: "signed_out" },
      {
        headers: {
          "Set-Cookie": clearSessionCookie(),
          "Cache-Control": "no-store",
        },
      },
    );
  });
}
