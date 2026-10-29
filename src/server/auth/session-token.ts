import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "ri_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return value.join("=") || null;
  }

  return null;
}

export function sessionCookie(
  token: string,
  maxAge = SESSION_MAX_AGE_SECONDS,
): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(): string {
  return sessionCookie("", 0);
}
