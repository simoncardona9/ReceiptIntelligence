import { z } from "zod";
import { identityService } from "@/server/auth/runtime";
import { readSessionToken } from "@/server/auth/session-token";
import { DomainError } from "@/server/auth/contracts";

export async function withApiErrors(
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DomainError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
        },
      },
      { status: 500 },
    );
  }
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new DomainError(
      "INVALID_JSON",
      400,
      "Request body must be valid JSON.",
    );
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw new DomainError("VALIDATION_FAILED", 400, issues);
  }
  return parsed.data;
}

export async function authenticatedSession(request: Request) {
  return identityService().currentSession(readSessionToken(request));
}

export function parseUuid(value: string, field = "id"): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "INVALID_IDENTIFIER",
      400,
      `${field} must be a UUID.`,
    );
  }
  return parsed.data;
}
