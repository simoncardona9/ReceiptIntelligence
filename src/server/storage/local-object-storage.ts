import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { DomainError } from "@/server/auth/contracts";
import type { ObjectStoragePort } from "./contracts";

export class LocalObjectStorage implements ObjectStoragePort {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  async put(key: string, content: Uint8Array): Promise<void> {
    const path = this.objectPath(key);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  }

  async read(key: string): Promise<Uint8Array> {
    try {
      return await readFile(this.objectPath(key));
    } catch {
      throw new DomainError(
        "SOURCE_UNAVAILABLE",
        404,
        "Source file not found.",
      );
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.objectPath(key), { force: true });
  }

  private objectPath(key: string): string {
    if (!/^[0-9a-f-]{36}$/.test(key)) {
      throw new DomainError(
        "SOURCE_UNAVAILABLE",
        404,
        "Source file not found.",
      );
    }
    const path = resolve(this.root, key);
    if (isAbsolute(key) || !path.startsWith(`${this.root}/`)) {
      throw new DomainError(
        "SOURCE_UNAVAILABLE",
        404,
        "Source file not found.",
      );
    }
    return path;
  }
}
