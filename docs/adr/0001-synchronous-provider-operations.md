# ADR 0001: Synchronous provider operations

Provider calls run in Convex actions and return a result or classified error to the caller. The component has no queue or automatic retry loop. Apps needing durable background execution must supply orchestration.

Keyed order, plan and subscription creates reserve a mode-scoped local claim before POST. Concurrent or uncertain outcomes remain pending. Retries reconcile through at most 20 pages of 100 provider records; any unresolved claim returns `RAZORPAY_IDEMPOTENCY_PENDING` without another POST. Apps must resolve the provider outcome before releasing a claim. Refunds use the provider idempotency header. Customer keys deduplicate completed mirrors without reserving a pending claim.
