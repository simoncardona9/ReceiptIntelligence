import type { IdentityRepository } from "./repositories";
import {
  DomainError,
  type SessionContext,
  type UserSummary,
} from "./contracts";
import { hashPassword, verifyPassword } from "./password";
import {
  createSessionToken,
  hashSessionToken,
  SESSION_MAX_AGE_SECONDS,
} from "./session-token";

const DUMMY_PASSWORD_HASH = "invalid-scrypt-hash";

export class IdentityService {
  constructor(private readonly repository: IdentityRepository) {}

  async register(email: string, password: string) {
    const passwordHash = await hashPassword(password);
    await this.repository.registerAccount({
      email,
      passwordHash,
    });
    return { status: "continue_to_sign_in" as const };
  }

  async bootstrapOwner(email: string, password: string, workspaceName: string) {
    if (await this.repository.findUserByEmail(email)) return false;
    const passwordHash = await hashPassword(password);
    return this.repository.bootstrapOwner({
      email,
      passwordHash,
      workspaceName,
    });
  }

  async login(email: string, password: string) {
    const user = await this.repository.findUserByEmail(email);
    const passwordMatches = await verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      throw new DomainError(
        "INVALID_CREDENTIALS",
        401,
        "Invalid email or password.",
      );
    }

    const token = createSessionToken();
    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    });

    return { user: { id: user.id, email: user.email }, token };
  }

  async currentSession(token: string | null): Promise<SessionContext> {
    if (!token) {
      throw new DomainError(
        "AUTHENTICATION_REQUIRED",
        401,
        "Sign in to continue.",
      );
    }

    const session = await this.repository.findSessionByTokenHash(
      hashSessionToken(token),
    );
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new DomainError(
        "AUTHENTICATION_REQUIRED",
        401,
        "Sign in to continue.",
      );
    }
    return session;
  }

  async workspaces(userId: string) {
    return this.repository.listWorkspaces(userId);
  }

  async logout(token: string | null): Promise<void> {
    if (token) {
      await this.repository.revokeSessionByTokenHash(hashSessionToken(token));
    }
  }
}

export function publicUser(user: UserSummary): UserSummary {
  return { id: user.id, email: user.email };
}
