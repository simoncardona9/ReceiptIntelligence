import { z } from "zod";

const appConfigSchema = z
  .object({
    DATABASE_URL: z
      .url({ error: "must be a valid URL" })
      .refine(
        (value) =>
          value.startsWith("postgres://") || value.startsWith("postgresql://"),
        { error: "must use the postgres:// or postgresql:// scheme" },
      ),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    SOURCE_STORAGE_DIRECTORY: z
      .string()
      .min(1)
      .default("./.receipt-storage/private"),
    OCR_ENGINE: z.enum(["paddle", "tesseract"]).default("tesseract"),
    OCR_DEVICE: z.enum(["cpu", "gpu"]).default("cpu"),
    BOOTSTRAP_OWNER_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
    ),
    BOOTSTRAP_OWNER_PASSWORD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(12).max(128).optional(),
    ),
    BOOTSTRAP_WORKSPACE_NAME: z.string().trim().min(1).max(80).default("Casa"),
  })
  .superRefine((value, context) => {
    if (value.OCR_ENGINE === "tesseract" && value.OCR_DEVICE === "gpu") {
      context.addIssue({
        code: "custom",
        path: ["OCR_DEVICE"],
        message: "GPU requires the PaddleOCR engine",
      });
    }
    if (
      Boolean(value.BOOTSTRAP_OWNER_EMAIL) !==
      Boolean(value.BOOTSTRAP_OWNER_PASSWORD)
    ) {
      context.addIssue({
        code: "custom",
        path: [
          value.BOOTSTRAP_OWNER_EMAIL
            ? "BOOTSTRAP_OWNER_PASSWORD"
            : "BOOTSTRAP_OWNER_EMAIL",
        ],
        message:
          "must be configured together with the other bootstrap credential",
      });
    }
  });

export type AppConfig = {
  databaseUrl: string;
  port: number;
  sourceStorageDirectory: string;
  ocrEngine: "paddle" | "tesseract";
  ocrDevice: "cpu" | "gpu";
  bootstrapOwner: {
    email: string;
    password: string;
    workspaceName: string;
  } | null;
};

export type Environment = Readonly<Record<string, string | undefined>>;

export type ConfigValidation =
  { success: true; data: AppConfig } | { success: false; errors: string[] };

export function validateAppConfig(environment: Environment): ConfigValidation {
  const parsed = appConfigSchema.safeParse(environment);

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => {
        const variable = issue.path.join(".") || "environment";
        return `${variable}: ${issue.message}`;
      }),
    };
  }

  return {
    success: true,
    data: {
      databaseUrl: parsed.data.DATABASE_URL,
      port: parsed.data.PORT,
      sourceStorageDirectory: parsed.data.SOURCE_STORAGE_DIRECTORY,
      ocrEngine: parsed.data.OCR_ENGINE,
      ocrDevice: parsed.data.OCR_DEVICE,
      bootstrapOwner:
        parsed.data.BOOTSTRAP_OWNER_EMAIL &&
        parsed.data.BOOTSTRAP_OWNER_PASSWORD
          ? {
              email: parsed.data.BOOTSTRAP_OWNER_EMAIL,
              password: parsed.data.BOOTSTRAP_OWNER_PASSWORD,
              workspaceName: parsed.data.BOOTSTRAP_WORKSPACE_NAME,
            }
          : null,
    },
  };
}

export function loadAppConfig(
  environment: Environment = process.env,
): AppConfig {
  const result = validateAppConfig(environment);

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${result.errors.join("; ")}`,
    );
  }

  return result.data;
}
