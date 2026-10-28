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
    });
  });
});
