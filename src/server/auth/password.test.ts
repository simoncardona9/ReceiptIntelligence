import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { createSessionToken, hashSessionToken } from "./session-token";

describe("credential protection", () => {
  it("stores a salted scrypt hash and verifies only the matching password", async () => {
    const encoded = await hashPassword("synthetic-passphrase-42");

    expect(encoded.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("synthetic-passphrase-42", encoded)).toBe(true);
    expect(
      await verifyPassword("a different synthetic password", encoded),
    ).toBe(false);
    expect(await verifyPassword("synthetic-passphrase-42", "invalid")).toBe(
      false,
    );
  });

  it("creates high-entropy opaque session tokens and stores only their hashes", () => {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);

    expect(token).toHaveLength(43);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(token);
  });
});
