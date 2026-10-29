import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  extractionResultSchema,
  ExtractionFailure,
  type ExtractionResult,
  type ExtractionSource,
  type ReceiptExtractionPort,
} from "./contracts";

const MAX_OUTPUT_BYTES = 2_000_000;
const EXTENSION = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
} as const;

export class LocalWorkerExtractionAdapter implements ReceiptExtractionPort {
  constructor(
    private readonly engine: "paddle" | "tesseract",
    private readonly device: "cpu" | "gpu" = "cpu",
    private readonly pythonCommand = "python3",
    private readonly workerScript = resolve("extraction/worker.py"),
    private readonly timeoutMs = 120_000,
  ) {}

  async extract(
    sources: ExtractionSource[],
    signal?: AbortSignal,
  ): Promise<ExtractionResult> {
    if (sources.length < 1 || sources.length > 20)
      throw new ExtractionFailure("INVALID_REQUEST", false);
    const directory = await mkdtemp(join(tmpdir(), "receipt-ocr-"));
    await chmod(directory, 0o700);
    try {
      const descriptors = [];
      for (const source of sources) {
        const path = join(
          directory,
          `${randomUUID()}${EXTENSION[source.mediaType]}`,
        );
        await writeFile(path, source.bytes, { mode: 0o600, flag: "wx" });
        descriptors.push({ id: source.id, mediaType: source.mediaType, path });
      }
      return await this.run(
        {
          version: 1,
          engine: this.engine,
          device: this.device,
          sources: descriptors,
        },
        directory,
        signal,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private run(
    request: object,
    directory: string,
    signal?: AbortSignal,
  ): Promise<ExtractionResult> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(this.pythonCommand, [this.workerScript], {
        cwd: process.cwd(),
        env: { ...process.env, OCR_ALLOWED_ROOT: directory },
        stdio: ["pipe", "pipe", "ignore"],
      });
      let output = "";
      let settled = false;
      let timedOut = false;
      const finish = (error?: ExtractionFailure, result?: ExtractionResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        if (error) reject(error);
        else if (result) resolveResult(result);
      };
      const cancel = () => {
        child.kill("SIGKILL");
        finish(new ExtractionFailure("CANCELLED", false));
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.timeoutMs);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.length > MAX_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new ExtractionFailure("ENGINE_OUTPUT_INVALID", false));
        }
      });
      child.on("error", () =>
        finish(new ExtractionFailure("WORKER_UNAVAILABLE", true, true)),
      );
      child.on("close", () => {
        if (settled) return;
        if (timedOut)
          return finish(new ExtractionFailure("ENGINE_TIMEOUT", true));
        try {
          const body = JSON.parse(output) as unknown;
          if (typeof body === "object" && body !== null && "error" in body) {
            const value = body.error as { code?: unknown; retryable?: unknown };
            const code =
              typeof value?.code === "string" && /^[A-Z_]+$/.test(value.code)
                ? value.code
                : "WORKER_FAILED";
            return finish(
              new ExtractionFailure(
                code,
                value?.retryable === true,
                code === "RESOURCE_FAILURE",
              ),
            );
          }
          const parsed = extractionResultSchema.safeParse(body);
          if (!parsed.success)
            return finish(
              new ExtractionFailure("ENGINE_OUTPUT_INVALID", false),
            );
          finish(undefined, parsed.data);
        } catch {
          finish(new ExtractionFailure("ENGINE_OUTPUT_INVALID", false));
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
