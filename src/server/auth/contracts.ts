export type WorkspaceRole = "owner" | "editor" | "viewer";
export type AccessDecision = "approve" | "decline";
export type AccessRequestStatus = "pending" | "approved" | "declined";
export type AuditAction =
  | "account_registered"
  | "session_created"
  | "session_revoked"
  | "workspace_created"
  | "workspace_selected"
  | "access_requested"
  | "access_approved"
  | "access_declined";

export type AuditEvent = Readonly<{
  actorUserId: string;
  workspaceId: string | null;
  action: AuditAction;
  subjectId: string;
  metadata?: Readonly<{ role?: "editor" | "viewer" }>;
}>;

export type UserSummary = {
  id: string;
  email: string;
};

export type UserCredential = UserSummary & {
  passwordHash: string;
};

export type SessionContext = {
  id: string;
  user: UserSummary;
  activeWorkspaceId: string | null;
  expiresAt: string;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
};

export type AccessRequestSummary = {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  status: AccessRequestStatus;
  requestedAt: string;
};

export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
