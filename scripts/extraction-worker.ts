import "dotenv/config";
import { Pool } from "pg";
import { loadAppConfig } from "../src/server/config/app-config";
import {
  PostgresExtractionQueueRepository,
  type ClaimedJob,
} from "../src/server/adapters/postgres/extraction-queue-repository";
import { LocalObjectStorage } from "../src/server/storage/local-object-storage";
import { LocalWorkerExtractionAdapter } from "../src/server/extraction/local-worker-adapter";
import { ExtractionFailure } from "../src/server/extraction/contracts";
import { DomainError } from "../src/server/auth/contracts";

const LOCK_ID = 74192832;
const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function processJob(
  repository: PostgresExtractionQueueRepository,
  storage: LocalObjectStorage,
  adapter: LocalWorkerExtractionAdapter,
  job: ClaimedJob,
  stopped: () => boolean,
): Promise<void> {
  const controller = new AbortController();
  const watcher = setInterval(() => {
    if (stopped()) controller.abort();
    void repository
      .isRunning(job.jobId, job.runToken)
      .then((running) => {
        if (!running) controller.abort();
      })
      .catch(() => controller.abort());
  }, 300);
  try {
    if (job.sources.length === 0)
      throw new ExtractionFailure("SOURCE_UNAVAILABLE", false);
    const sources = await Promise.all(
      job.sources.map(async (source) => ({
        id: source.id,
        mediaType: source.mediaType,
        bytes: await storage.read(source.storageKey),
      })),
    );
    if (controller.signal.aborted) return;
    const result = await adapter.extract(sources, controller.signal);
    if (controller.signal.aborted) return;
    const ids = new Set(job.sources.map((source) => source.id));
    if (result.pages.some((page) => !ids.has(page.sourceId)))
      throw new ExtractionFailure("ENGINE_OUTPUT_INVALID", false);
    await repository.complete(job, result);
  } catch (error) {
    if (controller.signal.aborted) return;
    const failure =
      error instanceof ExtractionFailure
        ? error
        : error instanceof DomainError
          ? new ExtractionFailure("SOURCE_UNAVAILABLE", false)
          : typeof error === "object" &&
              error !== null &&
              "code" in error &&
              (error.code === "ENOMEM" || error.code === "ENOSPC")
            ? new ExtractionFailure("RESOURCE_FAILURE", true, true)
            : new ExtractionFailure("WORKER_FAILED", true);
    await repository.fail(
      job,
      failure.code,
      failure.retryable,
      failure.resourceFailure,
    );
  } finally {
    clearInterval(watcher);
  }
}

async function run(): Promise<void> {
  const config = loadAppConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 3000,
    max: 4,
  });
  const repository = new PostgresExtractionQueueRepository(pool);
  const storage = new LocalObjectStorage(config.sourceStorageDirectory);
  const adapter = new LocalWorkerExtractionAdapter(
    config.ocrEngine,
    config.ocrDevice,
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const lockClient = await pool.connect();
  lockClient.on("error", stop);
  let locked = false;
  try {
    while (!stopping && !locked) {
      const result = await lockClient.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [LOCK_ID],
      );
      locked = result.rows[0].acquired;
      if (!locked) await sleep(3000);
    }
    if (!locked) return;
    await repository.recover();
    console.info("Extraction worker ready.");
    while (!stopping) {
      const job = await repository.claim();
      if (job)
        await processJob(repository, storage, adapter, job, () => stopping);
      else await sleep(1000);
    }
  } finally {
    if (locked)
      await lockClient
        .query("SELECT pg_advisory_unlock($1)", [LOCK_ID])
        .catch(() => undefined);
    lockClient.release();
    await pool.end();
  }
}

run().catch(() => {
  console.error("Extraction worker stopped after a safe runtime error.");
  process.exitCode = 1;
});
