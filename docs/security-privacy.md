# Security and Privacy

- Require authenticated, workspace-scoped access for all receipt metadata and source downloads.
- Enforce authorization on the server; an identifier alone must never select another workspace's data.
- Keep source files private and use short-lived, authorized download URLs or a server proxy.
- Encrypt traffic and storage using platform controls; secrets belong in a secret manager.
- Do not log receipt images, OCR text, full filenames when sensitive, payment details, or raw provider payloads.
- Define retention, deletion, export, and provider-processing policies before production.
- Treat extracted payment-card data as prohibited unless explicitly required and redacted/tokenized.
- Record audit events without duplicating receipt contents.
- Use synthetic fixtures for tests and demos.
- Review third-party extraction providers for data use, retention, residency, subprocessors, and incident handling.
