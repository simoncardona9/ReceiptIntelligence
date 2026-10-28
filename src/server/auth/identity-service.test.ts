import { describe, expect, it, vi } from "vitest";
import { DomainError } from "./contracts";
import { IdentityService } from "./identity-service";
import type { IdentityRepository } from "./repositories";

function fakeRepository(overrides: Partial<IdentityRepository> = {}) {
  const repository: IdentityRepository = {
    registerAccount: vi.fn(async () => undefined),
    findUserByEmail: vi.fn(async () => null),
    createSession: vi.fn(async () => undefined),
    findSessionByTokenHash: vi.fn(async () => null),
    revokeSessionByTokenHash: vi.fn(async () => undefined),
    listWorkspaces: vi.fn(async () => []),
    ...overrides,
  };
  return repository;
}

describe("identity service", () => {
  it("registers without creating a session or returning account details", async () => {
    const repository = fakeRepository();
    const service = new IdentityService(repository);

    const result = await service.register(
      "user@example.invalid",
      "synthetic-passphrase-42",
    );

    expect(result).toEqual({ status: "continue_to_sign_in" });
    expect(repository.registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.invalid",
        passwordHash: expect.stringMatching(/^scrypt\$/),
      }),
    );
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it("uses the same safe credential error for unknown users", async () => {
    const service = new IdentityService(fakeRepository());

    await expect(
      service.login("unknown@example.invalid", "synthetic-passphrase-42"),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
      message: "Invalid email or password.",
    } satisfies Partial<DomainError>);
  });

  it("requires an active, non-expired session", async () => {
    const service = new IdentityService(
      fakeRepository({
        findSessionByTokenHash: vi.fn(async () => ({
          id: "session-id",
          user: { id: "user-id", email: "user@example.invalid" },
          activeWorkspaceId: null,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })),
      }),
    );

    await expect(
      service.currentSession("synthetic-token"),
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  });
});
