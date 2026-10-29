import { describe, expect, it } from "vitest";
import { DomainError } from "./contracts";
import { assertSameOrigin } from "./origin";

describe("mutation origin validation", () => {
  it("accepts same-origin requests", () => {
    const request = new Request("http://0.0.0.0:3000/api/workspaces", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Host: "localhost:3000",
        "X-Forwarded-Proto": "http",
      },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects missing and cross-origin request origins", () => {
    expect(() =>
      assertSameOrigin(new Request("http://localhost:3000/api/workspaces")),
    ).toThrow(DomainError);
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/workspaces", {
          method: "POST",
          headers: { Origin: "https://attacker.example" },
        }),
      ),
    ).toThrowError("Request origin is not allowed.");
  });
});
