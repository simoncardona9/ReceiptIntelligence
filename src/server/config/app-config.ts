import { z } from "zod";

const appConfigSchema = z.object({
  DATABASE_URL: z
    .url({ error: "must be a valid URL" })
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      { error: "must use the postgres:// or postgresql:// scheme" },
    ),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type AppConfig = {
  databaseUrl: string;
  port: number;
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
