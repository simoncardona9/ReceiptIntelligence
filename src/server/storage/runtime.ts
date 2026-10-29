import { PostgresSourceRepository } from "@/server/adapters/postgres/source-repository";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { loadAppConfig } from "@/server/config/app-config";
import { LocalObjectStorage } from "./local-object-storage";
import { SourceService } from "./source-service";

export function sourceService(): SourceService {
  return new SourceService(
    new PostgresSourceRepository(getDatabasePool()),
    new LocalObjectStorage(loadAppConfig().sourceStorageDirectory),
  );
}
