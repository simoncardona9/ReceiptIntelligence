import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "@/server/auth/contracts";
import type {
  ObjectStoragePort,
  SourceFile,
  SourceMediaType,
  SourceRepository,
} from "./contracts";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES: readonly SourceMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function detectMediaType(bytes: Uint8Array): SourceMediaType | null {
  if (
    bytes.length >= 5 &&
    new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
  )
    return "application/pdf";
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

export class SourceService {
  constructor(
    private readonly repository: SourceRepository,
    private readonly storage: ObjectStoragePort,
  ) {}

  async upload(input: {
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    filename: string;
    declaredMediaType: string;
    bytes: Uint8Array;
  }): Promise<SourceFile> {
    if (input.bytes.length === 0 || input.bytes.length > MAX_SOURCE_BYTES) {
      throw new DomainError(
        "SOURCE_SIZE_INVALID",
        400,
        "Source file must be between 1 byte and 10 MB.",
      );
    }
    const detected = detectMediaType(input.bytes);
    if (
      !detected ||
      !ALLOWED_MEDIA_TYPES.includes(detected) ||
      input.declaredMediaType !== detected
    ) {
      throw new DomainError(
        "SOURCE_TYPE_INVALID",
        400,
        "Source file must be a valid JPEG, PNG, WebP, or PDF.",
      );
    }
    const filename = input.filename
      .trim()
      .replace(/[\\/\0-\x1f\x7f]/g, "_")
      .slice(-255);
    if (!filename)
      throw new DomainError(
        "SOURCE_FILENAME_INVALID",
        400,
        "A filename is required.",
      );

    const id = randomUUID();
    const storageKey = randomUUID();
    const metadata = {
      id,
      workspaceId: input.workspaceId,
      storageKey,
      contentHash: createHash("sha256").update(input.bytes).digest("hex"),
      mediaType: detected,
      originalFilename: filename,
      byteSize: input.bytes.length,
      uploadedBy: input.actorUserId,
      uploadedAt: new Date().toISOString(),
    } as const;
    await this.repository.authorizeUpload({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
    });
    await this.storage.put(storageKey, input.bytes);
    try {
      const result = await this.repository.create(
        metadata,
        input.idempotencyKey,
      );
      if (!result.created) await this.storage.remove(storageKey);
      return result.source;
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async download(workspaceId: string, sourceId: string, actorUserId: string) {
    const scope = { workspaceId, sourceId, actorUserId };
    const source = await this.repository.findForDownload(scope);
    const bytes = await this.storage.read(source.storageKey);
    await this.repository.recordDownload(scope);
    return { source, bytes };
  }

  async remove(workspaceId: string, sourceId: string, actorUserId: string) {
    const result = await this.repository.markRemoved({
      workspaceId,
      sourceId,
      actorUserId,
    });
    await this.storage.remove(result.storageKey);
    return { removed: true as const };
  }
}
