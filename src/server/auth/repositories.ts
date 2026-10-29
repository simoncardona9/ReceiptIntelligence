import type {
  AccessDecision,
  AccessRequestSummary,
  SessionContext,
  UserCredential,
  WorkspaceRole,
  WorkspaceSummary,
} from "./contracts";

export type WorkspaceScope = Readonly<{ workspaceId: string }>;

export interface IdentityRepository {
  registerAccount(input: {
    email: string;
    passwordHash: string;
  }): Promise<void>;
  findUserByEmail(email: string): Promise<UserCredential | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionContext | null>;
  revokeSessionByTokenHash(tokenHash: string): Promise<void>;
  listWorkspaces(userId: string): Promise<WorkspaceSummary[]>;
}

export interface WorkspaceRepository {
  createWorkspace(input: {
    userId: string;
    sessionId: string;
    idempotencyKey: string;
    name: string;
  }): Promise<WorkspaceSummary>;
  selectWorkspace(
    input: WorkspaceScope & {
      userId: string;
      sessionId: string;
    },
  ): Promise<WorkspaceSummary>;
  requestAccess(
    input: WorkspaceScope & {
      userId: string;
    },
  ): Promise<{ id: string; workspaceId: string; status: "pending" }>;
  listPendingRequests(
    input: WorkspaceScope & {
      ownerId: string;
    },
  ): Promise<AccessRequestSummary[]>;
  decideAccessRequest(
    input: WorkspaceScope & {
      ownerId: string;
      requestId: string;
      decision: AccessDecision;
      role: Exclude<WorkspaceRole, "owner"> | null;
    },
  ): Promise<void>;
}
