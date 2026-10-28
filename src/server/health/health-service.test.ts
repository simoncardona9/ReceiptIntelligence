import { describe, expect, it } from "vitest";
import { checkHealth } from "./health-service";
import type { DatabaseHealthPort } from "../ports/database-health-port";

describe("health service", () => {
  it("reports ready when the dependency responds", async () => {
    const database: DatabaseHealthPort = { isAvailable: async () => true };

    await expect(checkHealth(database)).resolves.toBe("ready");
  });

  it("reports unavailable when the dependency is down", async () => {
    const database: DatabaseHealthPort = { isAvailable: async () => false };

    await expect(checkHealth(database)).resolves.toBe("unavailable");
  });

  it("converts dependency errors into a safe unavailable result", async () => {
    const database: DatabaseHealthPort = {
      isAvailable: async () => {
        throw new Error("synthetic connection failure");
      },
    };

    await expect(checkHealth(database)).resolves.toBe("unavailable");
  });
});
