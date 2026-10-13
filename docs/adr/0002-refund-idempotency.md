# ADR 0002: Refund idempotency

Refund creation requires a valid idempotency key or receipt. A receipt derives a stable key and hash-based `X-Refund-Idempotency` header. The component checks the completed refund mirror and rejects changed requests; it does not reserve a local refund claim. Uncertain refunds rely on the provider header when retried with the same key.
