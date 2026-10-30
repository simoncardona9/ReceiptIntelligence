import { DomainError } from "@/server/auth/contracts";
import {
  PostgresExtractionQueueRepository,
  type QueueJob,
  type QueueSnapshot,
} from "@/server/adapters/postgres/extraction-queue-repository";

export class ExtractionQueueService {
  constructor(private readonly repository: PostgresExtractionQueueRepository) {}

  submit(
    workspaceId: string,
    actorUserId: string,
    receiptId: string,
    idempotencyKey: string,
  ): Promise<{ job: QueueJob; created: boolean }> {
    return this.repository.submit(
      workspaceId,
      actorUserId,
      receiptId,
      idempotencyKey,
    );
  }

  list(workspaceId: string, actorUserId: string): Promise<QueueSnapshot> {
    return this.repository.list(workspaceId, actorUserId);
  }

  prioritize(
    workspaceId: string,
    actorUserId: string,
    jobId: string,
    priority: number,
    key: string,
  ): Promise<QueueJob> {
    if (!Number.isInteger(priority) || priority < 0 || priority > 10)
      throw new DomainError(
        "INVALID_PRIORITY",
        400,
        "Priority must be 0 to 10.",
      );
    return this.repository.prioritize(
      workspaceId,
      actorUserId,
      jobId,
      priority,
      key,
    );
  }

  retry(
    workspaceId: string,
    actorUserId: string,
    jobId: string,
    key: string,
  ): Promise<QueueJob> {
    return this.repository.retry(workspaceId, actorUserId, jobId, key);
  }

  cancel(
    workspaceId: string,
    actorUserId: string,
    jobId: string,
    key: string,
  ): Promise<QueueJob> {
    return this.repository.cancel(workspaceId, actorUserId, jobId, key);
  }

  setPaused(
    workspaceId: string,
    actorUserId: string,
    paused: boolean,
    key: string,
  ): Promise<void> {
    return this.repository.setPaused(workspaceId, actorUserId, paused, key);
  }
}
