import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "./contracts";
import { requireWorkspacePermission } from "./authorization";

describe("workspace authorization policy", () => {
  const cases: Array<
    [WorkspaceRole, "read" | "edit" | "manage_access", boolean]
  > = [
    ["owner", "read", true],
    ["owner", "edit", true],
    ["owner", "manage_access", true],
    ["editor", "read", true],
    ["editor", "edit", true],
    ["editor", "manage_access", false],
    ["viewer", "read", true],
    ["viewer", "edit", false],
    ["viewer", "manage_access", false],
  ];

  it.each(cases)("%s may %s: %s", (role, permission, allowed) => {
    if (allowed) {
      expect(() => requireWorkspacePermission(role, permission)).not.toThrow();
    } else {
      expect(() => requireWorkspacePermission(role, permission)).toThrow();
    }
  });

  it("does not disclose an absent membership", () => {
    expect(() => requireWorkspacePermission(null, "read")).toThrow(
      expect.objectContaining({ code: "WORKSPACE_NOT_FOUND", status: 404 }),
    );
  });

  it("uses the stable owner error for access management", () => {
    expect(() => requireWorkspacePermission("viewer", "manage_access")).toThrow(
      expect.objectContaining({ code: "OWNER_REQUIRED", status: 403 }),
    );
  });
});
