import type { WorkspaceScope } from "@/server/auth/repositories";

export type SourceMediaType =
  "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export type SourceFile = Readonly<{
  id: string;
  workspaceId: string;
  contentHash: string;
  mediaType: SourceMediaType;
  originalFilename: string;
  byteSize: number;
  uploadedBy: string;
  uploadedAt: string;
  removedAt: string | null;
  removedBy: string | null;
}>;

export type SourceMetadata = Omit<SourceFile, "removedAt" | "removedBy"> & {
  storageKey: string;
};

export interface ObjectStoragePort {
  put(key: string, content: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

export interface SourceRepository {
  authorizeUpload(
    input: WorkspaceScope & { actorUserId: string },
  ): Promise<void>;
  create(
    input: SourceMetadata,
    idempotencyKey: string,
  ): Promise<{ source: SourceFile; created: boolean }>;
  findForDownload(
    input: WorkspaceScope & { sourceId: string; actorUserId: string },
  ): Promise<SourceMetadata>;
  recordDownload(
    input: WorkspaceScope & { sourceId: string; actorUserId: string },
  ): Promise<void>;
  markRemoved(
    input: WorkspaceScope & { sourceId: string; actorUserId: string },
  ): Promise<{ storageKey: string; removed: boolean }>;
}
