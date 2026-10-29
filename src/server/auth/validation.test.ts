import { describe, expect, it } from "vitest";
import { decisionSchema, registerSchema } from "./validation";

describe("auth request validation", () => {
  it("normalizes email and requires a passphrase of at least 12 characters", () => {
    expect(
      registerSchema.safeParse({
        email: "  Household@Example.Invalid ",
        password: "synthetic-passphrase",
      }),
    ).toMatchObject({
      success: true,
      data: { email: "household@example.invalid" },
    });
    expect(
      registerSchema.safeParse({
        email: "household@example.invalid",
        password: "short",
      }).success,
    ).toBe(false);
  });

  it("does not permit granting owner role through access approval", () => {
    expect(
      decisionSchema.safeParse({ decision: "approve", role: "viewer" }).success,
    ).toBe(true);
    expect(
      decisionSchema.safeParse({ decision: "approve", role: "owner" }).success,
    ).toBe(false);
    expect(
      decisionSchema.safeParse({ decision: "decline", role: "owner" }).success,
    ).toBe(false);
  });
});
