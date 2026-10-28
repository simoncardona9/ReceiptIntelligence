import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { PostgresAuthWorkspaceRepository } from "@/server/adapters/postgres/auth-workspace-repository";
import { IdentityService } from "./identity-service";
import { WorkspaceService } from "./workspace-service";

function repository() {
  return new PostgresAuthWorkspaceRepository(getDatabasePool());
}

export function identityService(): IdentityService {
  return new IdentityService(repository());
}

export function workspaceService(): WorkspaceService {
  return new WorkspaceService(repository());
}
