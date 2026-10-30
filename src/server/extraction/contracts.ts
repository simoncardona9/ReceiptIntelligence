import { z } from "zod";
import type { SourceMediaType } from "@/server/storage/contracts";

const regionSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(10000),
  confidence: z.number().min(0).max(1).nullable(),
  box: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .refine(
      ([left, top, right, bottom]) =>
        left >= 0 &&
        top >= 0 &&
        right <= 1 &&
        bottom <= 1 &&
        left < right &&
        top < bottom,
    )
    .nullable(),
});

export const extractionResultSchema = z.object({
  version: z.literal(1),
  engine: z.enum(["paddle", "tesseract"]),
  device: z.enum(["cpu", "gpu"]),
  pages: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        page: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        regions: z.array(regionSchema).max(10000),
      }),
    )
    .min(1)
    .max(20),
  diagnostics: z.object({ durationMs: z.number().nonnegative() }),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type ExtractionSource = {
  id: string;
  mediaType: SourceMediaType;
  bytes: Uint8Array;
};

export interface ReceiptExtractionPort {
  extract(
    sources: ExtractionSource[],
    signal?: AbortSignal,
  ): Promise<ExtractionResult>;
}

export class ExtractionFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly resourceFailure: boolean = false,
  ) {
    super(code);
  }
}
