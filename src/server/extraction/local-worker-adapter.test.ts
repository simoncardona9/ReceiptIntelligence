import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExtractionFailure } from "./contracts";
import { LocalWorkerExtractionAdapter } from "./local-worker-adapter";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fakeWorker(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ocr-adapter-test-"));
  directories.push(directory);
  const path = join(directory, "worker.py");
  await writeFile(path, contents);
  return path;
}

const source = {
  id: "d0b43567-67b4-4cc7-ad7c-f1804c0b1601",
  mediaType: "image/png" as const,
  bytes: Uint8Array.from([137, 80, 78, 71]),
};

describe("local OCR worker adapter", () => {
  it("validates neutral output and keeps source text out of errors", async () => {
    const script = await fakeWorker(`
import json, sys
request = json.load(sys.stdin)
print(json.dumps({"version": 1, "engine": request["engine"], "device": request["device"],
 "pages": [{"sourceId": request["sources"][0]["id"], "page": 0,
 "width": 10, "height": 10, "regions": [{"id": "1", "text": "SINTETICO",
 "confidence": .9, "box": [.1,.1,.9,.9]}]}], "diagnostics": {"durationMs": 1}}))
`);
    const result = await new LocalWorkerExtractionAdapter(
      "tesseract",
      "cpu",
      "python3",
      script,
    ).extract([source]);
    expect(result.pages[0].regions[0].text).toBe("SINTETICO");
    const text = await readFile(script, "utf8");
    expect(text).toContain("SINTETICO");
  });

  it("rejects malformed output with a stable code", async () => {
    const script = await fakeWorker(`print('PRIVATE OCR CONTENT')\n`);
    await expect(
      new LocalWorkerExtractionAdapter(
        "tesseract",
        "cpu",
        "python3",
        script,
      ).extract([source]),
    ).rejects.toMatchObject({
      code: "ENGINE_OUTPUT_INVALID",
    } satisfies Partial<ExtractionFailure>);
  });

  it("times out and stops a stalled worker", async () => {
    const script = await fakeWorker(`import time\ntime.sleep(5)\n`);
    await expect(
      new LocalWorkerExtractionAdapter(
        "tesseract",
        "cpu",
        "python3",
        script,
        30,
      ).extract([source]),
    ).rejects.toMatchObject({
      code: "ENGINE_TIMEOUT",
    } satisfies Partial<ExtractionFailure>);
  });
});
