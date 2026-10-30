import { PostgresExtractionQueueRepository } from "@/server/adapters/postgres/extraction-queue-repository";
import { getDatabasePool } from "@/server/adapters/postgres/database-pool";
import { ExtractionQueueService } from "./queue-service";

export function extractionQueueService(): ExtractionQueueService {
  return new ExtractionQueueService(
    new PostgresExtractionQueueRepository(getDatabasePool()),
  );
}
