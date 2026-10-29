import { DomainError, type WorkspaceRole } from "./contracts";

export type WorkspacePermission = "read" | "edit" | "manage_access";

const ROLE_PERMISSIONS: Readonly<
  Record<WorkspaceRole, readonly WorkspacePermission[]>
> = {
  owner: ["read", "edit", "manage_access"],
  editor: ["read", "edit"],
  viewer: ["read"],
};

export function requireWorkspacePermission(
  role: WorkspaceRole | null,
  permission: WorkspacePermission,
): void {
  if (!role) {
    throw new DomainError("WORKSPACE_NOT_FOUND", 404, "Workspace not found.");
  }
  if (ROLE_PERMISSIONS[role].includes(permission)) return;

  if (permission === "manage_access") {
    throw new DomainError(
      "OWNER_REQUIRED",
      403,
      "Only the workspace owner can review requests.",
    );
  }

  throw new DomainError(
    "WORKSPACE_PERMISSION_REQUIRED",
    403,
    "Your workspace role cannot perform this action.",
  );
}
