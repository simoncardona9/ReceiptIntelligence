import { DomainError } from "./contracts";
import type { WorkspaceRepository } from "./repositories";

export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  create(
    userId: string,
    sessionId: string,
    idempotencyKey: string | null,
    name: string,
  ) {
    if (!idempotencyKey) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "An Idempotency-Key header is required.",
      );
    }
    return this.repository.createWorkspace({
      userId,
      sessionId,
      idempotencyKey,
      name,
    });
  }

  select(userId: string, sessionId: string, workspaceId: string) {
    return this.repository.selectWorkspace({ userId, sessionId, workspaceId });
  }

  requestAccess(userId: string, workspaceId: string) {
    return this.repository.requestAccess({ userId, workspaceId });
  }

  pendingRequests(ownerId: string, workspaceId: string) {
    return this.repository.listPendingRequests({ ownerId, workspaceId });
  }

  decideAccess(
    ownerId: string,
    workspaceId: string,
    requestId: string,
    decision: "approve" | "decline",
    role: "editor" | "viewer" | null,
  ) {
    if (decision === "approve" && !role) {
      throw new DomainError(
        "INVALID_ROLE",
        400,
        "Choose an editor or viewer role.",
      );
    }
    return this.repository.decideAccessRequest({
      ownerId,
      workspaceId,
      requestId,
      decision,
      role,
    });
  }
}
