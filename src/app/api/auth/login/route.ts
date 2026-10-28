import { loginSchema } from "@/server/auth/validation";
import { identityService } from "@/server/auth/runtime";
import { assertSameOrigin } from "@/server/auth/origin";
import {
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
} from "@/server/auth/session-token";
import { readJson, withApiErrors } from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const input = await readJson(request, loginSchema);
    const result = await identityService().login(input.email, input.password);
    return Response.json(
      { user: result.user },
      {
        headers: {
          "Set-Cookie": sessionCookie(result.token, SESSION_MAX_AGE_SECONDS),
          "Cache-Control": "no-store",
        },
      },
    );
  });
}
