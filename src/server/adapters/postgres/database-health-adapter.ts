import { Pool } from "pg";
import type { DatabaseHealthPort } from "@/server/ports/database-health-port";

export class PostgresDatabaseHealthAdapter implements DatabaseHealthPort {
  constructor(private readonly connectionString: string) {}

  async isAvailable(): Promise<boolean> {
    const pool = new Pool({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 1500,
      max: 1,
    });

    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await pool.end();
    }
  }
}
