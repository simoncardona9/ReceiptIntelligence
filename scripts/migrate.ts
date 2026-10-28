import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { loadAppConfig } from "../src/server/config/app-config";

const migrationDirectory = join(process.cwd(), "migrations");
const pool = new Pool({
  connectionString: loadAppConfig().databaseUrl,
  connectionTimeoutMillis: 3000,
});

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [74192831]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationFiles = (await readdir(migrationDirectory))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
      .sort();

    for (const file of migrationFiles) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE id = $1",
        [file],
      );
      if (existing.rowCount) continue;

      const sql = await readFile(join(migrationDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.info(`Applied migration ${file}`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [74192831]);
    client.release();
    await pool.end();
  }
}

migrate().catch(() => {
  console.error(
    "Database migration failed. Check database availability and migration files.",
  );
  process.exitCode = 1;
});
