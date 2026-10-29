import "dotenv/config";
import { Pool } from "pg";
import { PostgresAuthWorkspaceRepository } from "../src/server/adapters/postgres/auth-workspace-repository";
import { loadAppConfig } from "../src/server/config/app-config";
import { IdentityService } from "../src/server/auth/identity-service";

async function run(): Promise<void> {
  const config = loadAppConfig();
  if (!config.bootstrapOwner) return;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Environment bootstrap credentials are disabled in production.",
    );
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 3000,
    max: 2,
  });
  try {
    const identity = new IdentityService(
      new PostgresAuthWorkspaceRepository(pool),
    );
    const created = await identity.bootstrapOwner(
      config.bootstrapOwner.email,
      config.bootstrapOwner.password,
      config.bootstrapOwner.workspaceName,
    );
    console.info(
      created
        ? "Configured bootstrap owner and workspace initialized."
        : "Configured bootstrap account already exists; no changes made.",
    );
  } finally {
    await pool.end();
  }
}

run().catch(() => {
  console.error("Bootstrap owner initialization failed.");
  process.exitCode = 1;
});
