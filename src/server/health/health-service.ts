import { PostgresDatabaseHealthAdapter } from "@/server/adapters/postgres/database-health-adapter";
import { loadAppConfig } from "@/server/config/app-config";
import type { DatabaseHealthPort } from "@/server/ports/database-health-port";

export type HealthStatus = "ready" | "unavailable";

export async function checkHealth(
  database: DatabaseHealthPort,
): Promise<HealthStatus> {
  try {
    return (await database.isAvailable()) ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function getHealthStatus(): Promise<HealthStatus> {
  try {
    const config = loadAppConfig();
    return await checkHealth(
      new PostgresDatabaseHealthAdapter(config.databaseUrl),
    );
  } catch {
    return "unavailable";
  }
}
