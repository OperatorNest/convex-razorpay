# 0007: Customer claim release, failed receipt redelivery and field names

Customers gain `releaseIdempotency`, matching orders, plans and subscriptions. A customer POST with an uncertain outcome leaves its claim pending; when listing reconciliation finds no provider customer with the claim's key, every retry raises `RAZORPAY_IDEMPOTENCY_PENDING` until the app establishes the provider outcome and releases the claim.

A failed webhook receipt no longer deduplicates a later delivery of the same event id or signed body, except a receipt failed with `RAZORPAY_STALE_WEBHOOK`. The redelivery is applied again in one transaction that deletes the failed receipt and inserts the new one, so each event id and body hash keeps at most one receipt. A transient apply failure therefore recovers through the provider's retry instead of becoming a permanent failed receipt; a stale event stays rejected so a retry after cleanup cannot apply it.

Convex field names are 1 or more printable ASCII characters not starting with `$`. Caller note and metadata keys outside that set raise `RAZORPAY_INVALID_ARGUMENT` in the client before any component call, because Convex rejects such keys while serializing function arguments. Provider responses and signed webhook bodies drop such keys, recursively, before any mirror or receipt is written, so one provider note key cannot fail every delivery of an event.
