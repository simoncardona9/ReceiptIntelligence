import { registerSchema } from "@/server/auth/validation";
import { identityService } from "@/server/auth/runtime";
import { assertSameOrigin } from "@/server/auth/origin";
import { readJson, withApiErrors } from "@/server/http/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const input = await readJson(request, registerSchema);
    const result = await identityService().register(
      input.email,
      input.password,
    );
    return Response.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
