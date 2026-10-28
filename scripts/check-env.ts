import "dotenv/config";
import { validateAppConfig } from "../src/server/config/app-config";

const result = validateAppConfig(process.env);

if (!result.success) {
  console.error(
    `Invalid environment configuration: ${result.errors.join("; ")}`,
  );
  process.exitCode = 1;
} else {
  console.info("Environment configuration is valid.");
}
