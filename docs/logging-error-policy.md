# Logging and Error Policy

- Use structured logs with request/correlation ID, safe actor/workspace reference, operation, outcome, and duration.
- Never log images, OCR text, raw receipt payloads, secrets, access tokens, or full payment data.
- Use typed domain errors for expected invalid state, authorization, conflict, validation, and provider failures.
- Map errors to stable safe client codes and messages.
- Keep durable audit events separate from technical logs.
- Provider failures must preserve the staged source and report retryable versus permanent status.
