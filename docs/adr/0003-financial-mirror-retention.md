# ADR 0003: Financial mirror retention

## Context

Batched retention must not erase active financial state. Orders, payments, refunds, customers, plans, and subscriptions are financial mirrors used for ownership checks, checkout verification, reconciliation, and app billing history. A fixed age cutoff could erase a still-active subscription or the evidence needed to resolve a payment. Unresolved idempotency claims can also represent ambiguous provider outcomes.

## Decision

The daily cron deletes webhook deduplication rows and completed or failed idempotency claims after 30 days. Entity mirrors and unresolved idempotency claims have no automatic age-based deletion. The consuming app must set its lawful retention and erasure policy and provide an explicit workflow before relying on deletion guarantees.

## Consequences

These tables can grow indefinitely. The component provides bounded indexed reads but does not claim automatic erasure of financial mirrors or unresolved claims. Operators must reconcile claims and plan app-specific retention before production use.
