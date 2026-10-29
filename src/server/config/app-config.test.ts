import { describe, expect, it } from "vitest";
import { loadAppConfig, validateAppConfig } from "./app-config";

describe("application configuration", () => {
  it("rejects missing required configuration without exposing values", () => {
    const result = validateAppConfig({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain("DATABASE_URL: must be a valid URL");
      expect(result.errors.join(" ")).not.toContain("postgres");
    }
  });

  it("rejects malformed database URLs and ports", () => {
    const result = validateAppConfig({
      DATABASE_URL: "mysql://synthetic.invalid/db",
      PORT: "70000",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "DATABASE_URL: must use the postgres:// or postgresql:// scheme",
          "PORT: Too big: expected number to be <=65535",
        ]),
      );
    }
  });

  it("parses valid local configuration without changing its connection string", () => {
    expect(
      loadAppConfig({
        DATABASE_URL: "postgresql://receipt:synthetic@localhost:5432/receipts",
        PORT: "4321",
      }),
    ).toEqual({
      databaseUrl: "postgresql://receipt:synthetic@localhost:5432/receipts",
      port: 4321,
      sourceStorageDirectory: "./.receipt-storage/private",
      bootstrapOwner: null,
    });
  });

  it("accepts a configured private source directory", () => {
    expect(
      validateAppConfig({
        DATABASE_URL: "postgresql://receipt:synthetic@localhost/db",
        SOURCE_STORAGE_DIRECTORY: "/var/lib/receipt-intelligence/sources",
      }),
    ).toMatchObject({
      success: true,
      data: { sourceStorageDirectory: "/var/lib/receipt-intelligence/sources" },
    });
  });

  it("parses paired bootstrap credentials and normalizes the owner email", () => {
    expect(
      loadAppConfig({
        DATABASE_URL: "postgresql://receipt:synthetic@localhost/db",
        BOOTSTRAP_OWNER_EMAIL: "Owner@Example.invalid",
        BOOTSTRAP_OWNER_PASSWORD: "synthetic-owner-passphrase-42",
      }).bootstrapOwner,
    ).toEqual({
      email: "owner@example.invalid",
      password: "synthetic-owner-passphrase-42",
      workspaceName: "Casa",
    });
  });

  it("requires both bootstrap credentials and never echoes their values", () => {
    const result = validateAppConfig({
      DATABASE_URL: "postgresql://receipt:synthetic@localhost/db",
      BOOTSTRAP_OWNER_EMAIL: "owner@example.invalid",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContain(
        "BOOTSTRAP_OWNER_PASSWORD: must be configured together with the other bootstrap credential",
      );
      expect(result.errors.join(" ")).not.toContain("owner@example.invalid");
    }
  });
});
