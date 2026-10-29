import { Pool } from "pg";
import { loadAppConfig } from "@/server/config/app-config";

let pool: Pool | undefined;

export function getDatabasePool(): Pool {
  pool ??= new Pool({
    connectionString: loadAppConfig().databaseUrl,
    connectionTimeoutMillis: 3000,
    max: 10,
  });
  return pool;
}
