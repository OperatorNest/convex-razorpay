# ADR 0002: Refund idempotency is required

## Context

Order, plan, and subscription creates permit optional keys. A repeated refund POST after an ambiguous outcome can refund the same payment twice. Razorpay accepts an `X-Refund-Idempotency` header with a restricted key format.

## Decision

Refund creation requires an explicit valid idempotency key or a receipt. A receipt produces a stable local claim and a hash-derived provider header. Other create calls retain their documented optional-key behavior.

## Consequences

Callers must identify each refund attempt. The component can safely reconcile retries without treating an ambiguous outcome as permission to issue an unkeyed refund.
