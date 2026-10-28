# API Documentation Policy

Every endpoint must document purpose, authentication, workspace scope, request
schema, successful response, status codes, stable error codes, authorization,
side effects, idempotency, and an example using synthetic data.

The contract must be updated in the same change as the route. The API must not
expose raw database errors, provider payloads, stack traces, secrets, or source
content through ordinary JSON responses.
