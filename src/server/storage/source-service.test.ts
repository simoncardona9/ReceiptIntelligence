import { describe, expect, it } from "vitest";
import { DomainError } from "@/server/auth/contracts";
import type {
  ObjectStoragePort,
  SourceFile,
  SourceMetadata,
  SourceRepository,
} from "./contracts";
import { SourceService } from "./source-service";

class MemoryStorage implements ObjectStoragePort {
  objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }
  async read(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("missing");
    return bytes;
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
}

class MemoryRepository implements SourceRepository {
  source:
    | (SourceMetadata & {
        removedAt?: string | null;
        removedBy?: string | null;
      })
    | null = null;
  downloads = 0;
  removals = 0;
  async authorizeUpload() {}
  async create(
    source: SourceMetadata,
  ): Promise<{ source: SourceFile; created: boolean }> {
    this.source = { ...source, removedAt: null, removedBy: null };
    return { source: this.publicSource(), created: true };
  }
  async findForDownload() {
    if (!this.source || this.source.removedAt)
      throw new DomainError("SOURCE_NOT_FOUND", 404, "Source file not found.");
    return this.source;
  }
  async recordDownload() {
    this.downloads += 1;
  }
  async markRemoved() {
    if (!this.source)
      throw new DomainError("SOURCE_NOT_FOUND", 404, "Source file not found.");
    if (!this.source.removedAt) {
      this.source.removedAt = new Date().toISOString();
      this.removals += 1;
    }
    return { storageKey: this.source.storageKey, removed: this.removals === 1 };
  }
  publicSource(): SourceFile {
    return {
      id: this.source!.id,
      workspaceId: this.source!.workspaceId,
      contentHash: this.source!.contentHash,
      mediaType: this.source!.mediaType,
      originalFilename: this.source!.originalFilename,
      byteSize: this.source!.byteSize,
      uploadedBy: this.source!.uploadedBy,
      uploadedAt: this.source!.uploadedAt,
      removedAt: this.source!.removedAt ?? null,
      removedBy: this.source!.removedBy ?? null,
    };
  }
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);

describe("SourceService", () => {
  it("stores validated source bytes with a content hash and metadata", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const service = new SourceService(repository, storage);
    const source = await service.upload({
      workspaceId: "workspace",
      actorUserId: "user",
      idempotencyKey: "key",
      filename: "receipt.jpg",
      declaredMediaType: "image/jpeg",
      bytes: jpeg,
    });
    expect(source.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(source.byteSize).toBe(jpeg.length);
    expect(storage.objects.get(repository.source!.storageKey)).toEqual(jpeg);
    expect(repository.source?.workspaceId).toBe("workspace");
  });

  it("rejects mismatched media types and oversized sources before storage", async () => {
    const storage = new MemoryStorage();
    const service = new SourceService(new MemoryRepository(), storage);
    await expect(
      service.upload({
        workspaceId: "w",
        actorUserId: "u",
        idempotencyKey: "key",
        filename: "x.pdf",
        declaredMediaType: "application/pdf",
        bytes: jpeg,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TYPE_INVALID" });
    await expect(
      service.upload({
        workspaceId: "w",
        actorUserId: "u",
        idempotencyKey: "key",
        filename: "x.jpg",
        declaredMediaType: "image/jpeg",
        bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_SIZE_INVALID" });
    expect(storage.objects.size).toBe(0);
  });

  it("authorizes before writing any binary", async () => {
    const repository = new MemoryRepository();
    repository.authorizeUpload = async () => {
      throw new DomainError("WORKSPACE_PERMISSION_REQUIRED", 403, "Forbidden.");
    };
    const storage = new MemoryStorage();
    const service = new SourceService(repository, storage);
    await expect(
      service.upload({
        workspaceId: "w",
        actorUserId: "viewer",
        idempotencyKey: "key",
        filename: "receipt.jpg",
        declaredMediaType: "image/jpeg",
        bytes: jpeg,
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_PERMISSION_REQUIRED" });
    expect(storage.objects.size).toBe(0);
  });

  it("audits download and makes removal retry-safe while retaining metadata", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const service = new SourceService(repository, storage);
    await service.upload({
      workspaceId: "w",
      actorUserId: "u",
      idempotencyKey: "key",
      filename: "r.jpg",
      declaredMediaType: "image/jpeg",
      bytes: jpeg,
    });
    const id = repository.source!.id;
    const downloaded = await service.download("w", id, "viewer");
    expect(downloaded.bytes).toEqual(jpeg);
    expect(repository.downloads).toBe(1);
    await service.remove("w", id, "editor");
    await service.remove("w", id, "editor");
    expect(storage.objects.size).toBe(0);
    expect(repository.removals).toBe(1);
    expect(repository.source).toMatchObject({
      id,
      removedAt: expect.any(String),
    });
    await expect(service.download("w", id, "viewer")).rejects.toMatchObject({
      code: "SOURCE_NOT_FOUND",
    });
  });
});
