import { DomainError } from "./contracts";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin) {
    throw new DomainError(
      "ORIGIN_REQUIRED",
      403,
      "Request origin is not allowed.",
    );
  }
  if (!host) {
    throw new DomainError(
      "ORIGIN_NOT_ALLOWED",
      403,
      "Request origin is not allowed.",
    );
  }

  try {
    const requestUrl = new URL(request.url);
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      .trim();
    const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
    if (new URL(origin).origin === new URL(`${protocol}://${host}`).origin)
      return;
  } catch {
    // Treat malformed Origin headers as untrusted.
  }

  throw new DomainError(
    "ORIGIN_NOT_ALLOWED",
    403,
    "Request origin is not allowed.",
  );
}
