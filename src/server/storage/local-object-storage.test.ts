import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalObjectStorage } from "./local-object-storage";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("LocalObjectStorage", () => {
  it("stores private bytes with restrictive permissions and supports safe retry removal", async () => {
    directory = await mkdtemp(join(tmpdir(), "receipt-storage-test-"));
    const storage = new LocalObjectStorage(join(directory, "private"));
    const key = "f6a0c400-6dd8-49ac-b244-bb3a993b583d";
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put(key, bytes);
    expect(Buffer.from(await storage.read(key))).toEqual(Buffer.from(bytes));
    expect((await stat(join(directory, "private"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "private", key))).mode & 0o777).toBe(
      0o600,
    );
    await storage.remove(key);
    await storage.remove(key);
    await expect(storage.read(key)).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
    });
  });

  it("rejects paths that are not generated UUID object keys", async () => {
    directory = await mkdtemp(join(tmpdir(), "receipt-storage-test-"));
    const storage = new LocalObjectStorage(directory);
    await expect(storage.read("../../etc/passwd")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
    });
  });
});
